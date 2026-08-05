import type {
  AssetAmount,
  Money,
  MoneyParser,
  Network,
  PaymentRequirements,
  Price,
  SchemePaymentRequiredContext,
  SchemeNetworkServer,
  SchemeServerHooks,
  SupportedKind,
} from "@x402/core/types";
import { sha256 } from "@noble/hashes/sha2.js";
import { convertToTokenAmount, numberToDecimalString, parseMoneyString } from "@x402/core/utils";
import { randomBytes } from "node:crypto";
import {
  ASSET_TRANSFER_METHOD_DEFAULT,
  ASSET_TRANSFER_METHOD_MASUMI,
  CANONICAL_CARDANO_ASSET_REGEX,
  ERR_SETTLEMENT_DEFINITIVELY_REJECTED,
  getDefaultUsdmAsset,
  isCardanoNetwork,
  POSITIVE_CANONICAL_AMOUNT_REGEX,
  SCHEME_EXACT,
  SUBMISSION_POLICY_EITHER,
  USDM_DEFAULT_DECIMALS,
} from "../../constants";
import {
  InMemoryCardanoOperationStore,
  type CardanoOperationStore,
  type CardanoStoredResponse,
  type InMemoryCardanoOperationStoreOptions,
} from "../../idempotency";
import { DEFAULT_CARDANO_REPLAY_BODY_BYTES } from "../../limits";
import { normalizeSubmissionMode, resolveCardanoPolicies } from "../../policy";
import type { CardanoExtraMasumi } from "../../types";
import { decodeCardanoTransaction } from "../../utils";
import { buildSignedTerms, computeTermsDigest } from "../masumi/digests";
import { jcs } from "../masumi/jcs";
import { validateMasumiExtra } from "../masumi/schema";

/** Cached protected-handler result bound to one payment and request. */
interface HandlerReplayOwner {
  key: string;
  ownerToken: string;
}

/** HTTP-like transport fields used without coupling the mechanism to one adapter. */
interface ReplayTransportContext {
  request?: {
    method?: string;
    adapter?: {
      getMethod?(): string;
      getUrl?(): string;
      getHeader?(name: string): string | undefined;
      getBody?(): unknown | Promise<unknown>;
      getRawBody?(): Uint8Array | undefined | Promise<Uint8Array | undefined>;
    };
  };
  responseBody?: Buffer;
  responseHeaders?: Record<string, string>;
  responseStatus?: number;
}

/** Headers that describe the buffered transfer, not the reusable representation. */
const NON_REPLAYABLE_RESPONSE_HEADERS = new Set([
  "authentication-info",
  "cache-control",
  "content-encoding",
  "content-length",
  "content-md5",
  "digest",
  "payment-response",
  "proxy-authenticate",
  "set-cookie",
  "settlement-overrides",
  "transfer-encoding",
  "www-authenticate",
]);

const DEFAULT_REQUEST_BINDING_HEADERS = ["authorization", "cookie", "x-api-key"] as const;
const CARDANO_REPLAY_EXTENSION_KEY = "cardanoReplayProtection";
const REPLAY_CHALLENGE_HEX = /^[0-9a-f]{64}$/;
const DEFAULT_REPLAY_CHALLENGE_TTL_MS = 15 * 60 * 1000;

/** Request data available to an application-specific replay-binding callback. */
export interface CardanoReplayBindingContext {
  method: string;
  url: string;
  contentType: string;
  body: unknown;
  rawBody?: Uint8Array;
  getHeader(name: string): string | undefined;
}

/** Cardano resource-server replay configuration. */
export interface ExactCardanoServerConfig {
  /**
   * Atomic durable idempotency store shared by every worker and deployment.
   * Replay tombstones must survive process restarts.
   */
  operationStore?: CardanoOperationStore;
  /**
   * Capacity settings for an explicitly selected process-local store. Supplying
   * this opts into volatile replay state and is suitable only for tests and
   * disposable development servers.
   */
  inMemoryStore?: InMemoryCardanoOperationStoreOptions;
  /**
   * Returns the authenticated principal/tenant binding for a paid request.
   * Authentication must run before the x402 middleware. Header values remain
   * part of the request fingerprint, but never prove authentication by
   * themselves when this callback is absent.
   */
  requestBinding?: (context: CardanoReplayBindingContext) => string | Promise<string>;
  /**
   * Returns exact bytes to bind when an adapter cannot expose `getRawBody()` and
   * its parsed body is not plain JSON. The default rejects unsupported values.
   */
  requestBodyBytes?: (
    context: CardanoReplayBindingContext,
  ) => Uint8Array | string | Promise<Uint8Array | string>;
  /** Maximum raw or canonical request-body bytes covered by one fingerprint. */
  maxRequestBodyBytes?: number;
  /** Minimum lifetime of an opaque challenge issued in a 402 response. */
  replayChallengeTtlMs?: number;
}

/**
 * Returns lowercase hexadecimal bytes.
 *
 * @param bytes - Bytes to encode.
 * @returns Lowercase hexadecimal string.
 */
function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex").toLowerCase();
}

/**
 * Validates one positive safe-integer configuration value.
 *
 * @param value - Candidate setting.
 * @param name - Setting name used in the error.
 * @returns The validated value.
 */
function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

/** Maximum nesting accepted by the default parsed-JSON replay serializer. */
const MAX_REPLAY_JSON_DEPTH = 64;
/** Maximum values visited by the default parsed-JSON replay serializer. */
const MAX_REPLAY_JSON_VALUES = 100_000;

/**
 * Rejects values whose JSON meaning is ambiguous across adapters. This also
 * prevents cycles and pathological nesting before JCS recursion begins.
 *
 * @param root - Parsed request body.
 * @param maxBytes - Maximum aggregate UTF-8 bytes.
 */
function assertPlainJson(root: unknown, maxBytes: number): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  const seen = new WeakSet<object>();
  let visited = 0;
  let bytes = 0;

  while (pending.length > 0) {
    const { value, depth } = pending.pop()!;
    visited++;
    if (visited > MAX_REPLAY_JSON_VALUES) {
      throw new Error("request body exceeds the JSON value limit");
    }
    if (depth > MAX_REPLAY_JSON_DEPTH) {
      throw new Error("request body exceeds the JSON nesting limit");
    }
    if (typeof value === "string") {
      bytes += Buffer.byteLength(value, "utf8");
      if (bytes > maxBytes) throw new Error("request body exceeds the byte limit");
      continue;
    }
    if (
      value === null ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      continue;
    }
    if (typeof value !== "object") {
      throw new Error(`request body contains unsupported ${typeof value} value`);
    }
    if (seen.has(value)) throw new Error("request body contains a cycle");
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) pending.push({ value: item, depth: depth + 1 });
      continue;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("request body must contain only plain JSON objects");
    }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      bytes += Buffer.byteLength(key, "utf8");
      if (bytes > maxBytes) throw new Error("request body exceeds the byte limit");
      pending.push({ value: item, depth: depth + 1 });
    }
  }
}

/**
 * Cardano server-side implementation for the Exact scheme.
 *
 * Performs Money-to-AssetAmount parsing using a registerable parser chain and
 * leaves Cardano-specific extra fields untouched, since most extras are
 * server-supplied (assetTransferMethod, Masumi metadata, script descriptors).
 */
export class ExactCardanoScheme implements SchemeNetworkServer {
  readonly scheme = SCHEME_EXACT;
  readonly requireMatchingPayloadResource = true;
  readonly schemeHooks: SchemeServerHooks;
  private readonly moneyParsers: MoneyParser[] = [];
  private readonly operationStore: CardanoOperationStore;
  private readonly requestBinding?: ExactCardanoServerConfig["requestBinding"];
  private readonly requestBodyBytes?: ExactCardanoServerConfig["requestBodyBytes"];
  private readonly maxRequestBodyBytes: number;
  private readonly replayChallengeTtlMs: number;
  private readonly replayOwners = new WeakMap<object, HandlerReplayOwner>();

  /**
   * Creates a server scheme with its Cardano replay lifecycle hooks.
   *
   * @param config - Replay persistence, capacity and requester-binding options.
   */
  constructor(config: ExactCardanoServerConfig = {}) {
    if (config.operationStore) {
      this.operationStore = config.operationStore;
    } else if (config.inMemoryStore) {
      this.operationStore = new InMemoryCardanoOperationStore(config.inMemoryStore);
    } else {
      throw new Error(
        "Cardano resource servers require a durable operationStore; pass inMemoryStore explicitly only for tests or disposable development",
      );
    }
    this.requestBinding = config.requestBinding;
    this.requestBodyBytes = config.requestBodyBytes;
    this.maxRequestBodyBytes = positiveSafeInteger(
      config.maxRequestBodyBytes ?? DEFAULT_CARDANO_REPLAY_BODY_BYTES,
      "maxRequestBodyBytes",
    );
    this.replayChallengeTtlMs = positiveSafeInteger(
      config.replayChallengeTtlMs ?? DEFAULT_REPLAY_CHALLENGE_TTL_MS,
      "replayChallengeTtlMs",
    );
    this.schemeHooks = {
      onAfterVerify: async context => {
        try {
          return await this.claimProtectedOperation(context);
        } catch {
          return {
            abort: true,
            reason: "payment_replay_store_unavailable",
            message: "Cardano replay protection is unavailable",
            status: 503,
          };
        }
      },
      onAfterSettle: async context => this.storeProtectedResult(context),
      onSettleFailure: async context => this.storeProtectedResult(context),
      onVerifiedPaymentCanceled: async context => this.cancelProtectedOperation(context),
    };
  }

  /**
   * Adds an opaque request-bound challenge to each Cardano 402. Normal x402 v2
   * clients echo top-level extensions in the paid retry. A fresh challenge is
   * issued for every unpaid response, so another caller cannot fetch the same
   * capability by repeating an anonymous request.
   *
   * @param context - Payment-required response being built.
   */
  async enrichPaymentRequiredResponse(context: SchemePaymentRequiredContext): Promise<void> {
    const transport = this.asReplayTransport(context.transportContext);
    if (!transport) return;
    if (!this.replayOwner(transport)) {
      throw new Error("Cardano replay protection requires a stable request adapter");
    }

    const binding = await this.requestFingerprint(transport);
    const requirementsFingerprint = this.requirementsFingerprint(context.requirement);
    const echoedChallenge = this.replayChallenge(
      context.paymentPayload?.extensions,
      requirementsFingerprint,
    );
    const canReuseEchoedChallenge = echoedChallenge
      ? await this.operationStore.validateChallenge(echoedChallenge, {
          fingerprint: binding.fingerprint,
          requirementsFingerprint,
        })
      : false;
    let challenge = canReuseEchoedChallenge ? echoedChallenge : undefined;
    if (!challenge) {
      const timeoutMs = context.requirement.maxTimeoutSeconds * 1000;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
        throw new Error("Cardano maxTimeoutSeconds cannot produce a safe challenge lifetime");
      }
      const lifetime = Math.max(this.replayChallengeTtlMs, timeoutMs);
      const expiresAt = Date.now() + lifetime;
      if (!Number.isSafeInteger(expiresAt)) {
        throw new Error("Cardano replay challenge expiry exceeds the safe integer range");
      }
      const issued = await this.operationStore.issueChallenge({
        fingerprint: binding.fingerprint,
        requirementsFingerprint,
        expiresAt,
      });
      if (issued.status === "capacity-exceeded") {
        throw new Error("Cardano replay challenge store is at capacity");
      }
      challenge = issued.challenge;
    }

    const current = this.replayExtension(context.paymentRequiredResponse.extensions);
    context.paymentRequiredResponse.extensions = {
      ...context.paymentRequiredResponse.extensions,
      [CARDANO_REPLAY_EXTENSION_KEY]: {
        challenges: { ...current, [requirementsFingerprint]: challenge },
      },
    };
  }

  /**
   * Registers a custom Money parser. Parsers are tried in registration order;
   * the first non-null result wins. Returns `null` to defer to the next parser.
   *
   * @param parser - The parser to register.
   * @returns This instance for chaining.
   */
  registerMoneyParser(parser: MoneyParser): ExactCardanoScheme {
    this.moneyParsers.push(parser);
    return this;
  }

  /**
   * Converts a price into an AssetAmount. AssetAmount inputs are passed through
   * after validation. Money inputs use the parser chain, then USDM conversion.
   *
   * @param price - The price to parse.
   * @param network - The Cardano network identifier.
   * @returns The resolved AssetAmount.
   */
  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    if (typeof price === "object" && price !== null && "amount" in price) {
      if (!price.asset) {
        throw new Error(`Asset unit must be specified for AssetAmount on network ${network}`);
      }
      return this.validateAssetAmount(
        { amount: price.amount, asset: price.asset, extra: price.extra ?? {} },
        "AssetAmount",
      );
    }

    const decimal = this.parseMoneyToDecimal(price as Money);
    for (const parser of this.moneyParsers) {
      const result = await parser(decimal, network);
      if (result !== null) {
        return this.validateAssetAmount(result, "Custom money parser result");
      }
    }
    return this.validateAssetAmount(
      this.defaultMoneyConversion(decimal, network),
      "Default money conversion",
    );
  }

  /**
   * Returns the decimal precision for the supplied asset. The default is six;
   * integrators can subclass this scheme for another token precision.
   *
   * @param _asset - The asset unit string.
   * @param _network - The Cardano network identifier.
   * @returns Decimal precision.
   */
  getAssetDecimals(_asset: string, _network: Network): number {
    void _asset;
    void _network;
    return USDM_DEFAULT_DECIMALS;
  }

  /**
   * Leaves requirement extras unchanged. `/supported` extras advertise
   * capabilities; they are not payment semantics and Masumi extras are closed.
   *
   * @param paymentRequirements - The base payment requirements.
   * @param supportedKind - The matching SupportedKind.
   * @param extensionKeys - The facilitator extension keys.
   * @returns The unchanged payment requirements.
   */
  async enhancePaymentRequirements(
    paymentRequirements: PaymentRequirements,
    supportedKind: SupportedKind,
    extensionKeys: string[],
  ): Promise<PaymentRequirements> {
    void extensionKeys;
    if (!isCardanoNetwork(supportedKind.network)) {
      throw new Error(`Unsupported Cardano network: ${supportedKind.network}`);
    }
    this.assertFacilitatorSupportsRequirements(paymentRequirements, supportedKind);
    // The one capability restated in the 402: who pays the network fee. Copied
    // from the facilitator's advertisement, as on the other schemes. Every
    // other capability key stays out of `extra`, which the Masumi schema
    // validates as a closed object.
    const areFeesSponsored = supportedKind.extra?.areFeesSponsored;
    return {
      ...paymentRequirements,
      extra: {
        ...paymentRequirements.extra,
        ...(typeof areFeesSponsored === "boolean" && { areFeesSponsored }),
      },
    };
  }

  /**
   * Checks selected Cardano payment semantics against the facilitator's
   * advertised capabilities without copying capability metadata into the 402.
   *
   * The check is all-or-nothing on purpose. A facilitator that publishes no
   * `extra` at all has told us nothing, so there is nothing to check and the
   * requirements pass. One that publishes an `extra` has claimed to describe
   * itself, and every capability this scheme selects must then appear in it —
   * a half-filled advertisement is treated as a rejection rather than as
   * permission, because the alternative is serving a 402 nobody can settle.
   *
   * @param requirements - Requirements about to be served.
   * @param supportedKind - Matching facilitator capability advertisement.
   */
  private assertFacilitatorSupportsRequirements(
    requirements: PaymentRequirements,
    supportedKind: SupportedKind,
  ): void {
    const advertised = supportedKind.extra;
    if (advertised === undefined || advertised === null) return;
    if (typeof advertised !== "object" || Array.isArray(advertised)) {
      throw new Error("Cardano facilitator advertised a malformed capability block");
    }

    const capabilities = advertised as Record<string, unknown>;
    const method = requirements.extra?.assetTransferMethod ?? ASSET_TRANSFER_METHOD_DEFAULT;
    const methods = capabilities.assetTransferMethods;
    if (!Array.isArray(methods)) {
      throw new Error("Cardano facilitator did not advertise assetTransferMethods");
    }
    if (!methods.includes(method)) {
      throw new Error(`Cardano facilitator does not support assetTransferMethod ${String(method)}`);
    }

    const policies = resolveCardanoPolicies(requirements.extra);
    if (!policies) {
      throw new Error("Cardano requirements carry an invalid submission/confirmation policy");
    }
    const selectedModes =
      policies.submissionPolicy === SUBMISSION_POLICY_EITHER
        ? (["server", "client"] as const)
        : ([policies.submissionPolicy] as const);
    const advertisedModes = capabilities.submissionModes;
    if (!Array.isArray(advertisedModes)) {
      throw new Error("Cardano facilitator did not advertise submissionModes");
    }
    const confirmationRanges = capabilities.l1Confirmations;
    if (
      !confirmationRanges ||
      typeof confirmationRanges !== "object" ||
      Array.isArray(confirmationRanges)
    ) {
      throw new Error("Cardano facilitator did not advertise l1Confirmations");
    }
    for (const mode of selectedModes) {
      if (!advertisedModes.includes(mode)) {
        throw new Error(`Cardano facilitator does not support ${mode} submission`);
      }
      const range = (confirmationRanges as Record<string, unknown>)[mode];
      if (!range || typeof range !== "object" || Array.isArray(range)) {
        throw new Error(
          `Cardano facilitator did not advertise an L1 confirmation range for ${mode}`,
        );
      }
      const minimum = (range as Record<string, unknown>).minimum;
      const maximum = (range as Record<string, unknown>).maximum;
      if (
        typeof minimum !== "number" ||
        !Number.isInteger(minimum) ||
        typeof maximum !== "number" ||
        !Number.isInteger(maximum) ||
        policies.confirmationPolicy.l1Confirmations < minimum ||
        policies.confirmationPolicy.l1Confirmations > maximum
      ) {
        throw new Error(
          `Cardano facilitator ${mode} confirmation range does not include ${policies.confirmationPolicy.l1Confirmations}`,
        );
      }
    }

    if (method === ASSET_TRANSFER_METHOD_MASUMI) {
      // `extra` is still the raw wire object here, so `settlementPolicy` comes
      // from the schema check rather than from an unchecked cast. The schema
      // requires the field, which is why there is no default to apply.
      const schema = validateMasumiExtra(requirements.extra, requirements.network);
      if (!schema.ok) {
        throw new Error(`Cardano Masumi requirements are invalid: ${schema.detail}`);
      }
      const settlementPolicy = schema.extra.terms.settlementPolicy;
      const advertisedLayers = capabilities.settlementLayers;
      if (!Array.isArray(advertisedLayers)) {
        throw new Error("Cardano facilitator did not advertise settlementLayers");
      }
      // `auto` lets the buyer choose, and the only layer this scheme can
      // actually authenticate is L1 — a Hydra payload is refused outright in
      // `verifyMasumiLock`. Accepting `auto` against a Hydra-only facilitator
      // would serve a 402 whose every payment is rejected at verification.
      // An explicit `hydra` policy still defers to the advertisement, so a
      // subclass that does implement Hydra keeps working.
      const supported =
        settlementPolicy === "auto"
          ? advertisedLayers.includes("l1")
          : advertisedLayers.includes(settlementPolicy);
      if (!supported) {
        throw new Error(
          `Cardano facilitator does not support Masumi ${String(settlementPolicy)} settlement`,
        );
      }
    }
  }

  /**
   * Claims a canonical transaction (or Masumi terms digest) before the handler
   * runs. Identical paid retries receive the stored result; concurrent or
   * mismatched uses cannot execute the handler again.
   *
   * @param context - Core after-verify hook context.
   * @returns A skip or abort directive when a prior claim exists.
   */
  private async claimProtectedOperation(
    context: Parameters<NonNullable<SchemeServerHooks["onAfterVerify"]>>[0],
  ): Promise<
    | void
    | { skipHandler: true; response: CardanoStoredResponse }
    | { abort: true; reason: string; message: string; status?: number }
  > {
    if (!context.result.isValid) return;
    const transport = this.asReplayTransport(context.transportContext);
    if (!transport) return;
    const replayOwner = this.replayOwner(transport);
    if (!replayOwner) {
      return {
        abort: true,
        reason: "payment_replay_store_unavailable",
        message: "Cardano replay protection requires a stable request adapter",
        status: 503,
      };
    }

    let identity: { key: string; txHash: string };
    try {
      identity = this.paymentIdentity(context.paymentPayload, context.requirements);
    } catch (cause) {
      return {
        abort: true,
        reason: "invalid_exact_cardano_payload",
        message: cause instanceof Error ? cause.message : String(cause),
      };
    }
    const binding = await this.requestFingerprint(transport);
    const requirementsFingerprint = this.requirementsFingerprint(context.requirements);
    const replayChallenge = this.replayChallenge(
      context.paymentPayload.extensions,
      requirementsFingerprint,
    );
    const submissionMode = normalizeSubmissionMode(
      (context.paymentPayload.payload as { submissionMode?: unknown }).submissionMode,
    );
    if (submissionMode === "client" && !binding.isRequesterAuthenticated) {
      return {
        abort: true,
        reason: "payment_replay_binding_required",
        message: "client-submitted Cardano payments require an authenticated requester binding",
        status: 403,
      };
    }
    const ownerToken = randomBytes(16).toString("hex");
    const claim = await this.operationStore.claim({
      ...identity,
      fingerprint: binding.fingerprint,
      requirementsFingerprint,
      ...(replayChallenge ? { replayChallenge } : {}),
      requireReplayChallenge: submissionMode === "client" || !binding.isRequesterAuthenticated,
      ownerToken,
    });
    switch (claim.status) {
      case "transaction-conflict":
        return {
          abort: true,
          reason: "duplicate_settlement",
          message: "payment terms are already bound to a different Cardano transaction",
          status: 409,
        };
      case "request-conflict":
        return {
          abort: true,
          reason: "payment_replay_conflict",
          message: "Cardano transaction is already bound to a different protected request",
          status: 409,
        };
      case "completed":
        return {
          skipHandler: true,
          response: {
            ...claim.response,
            headers: { ...claim.response.headers },
            body: Buffer.isBuffer(claim.response.body)
              ? Buffer.from(claim.response.body)
              : claim.response.body,
          },
        };
      case "completed-without-response":
        return {
          abort: true,
          reason: "payment_replay_response_unavailable",
          message: "the paid operation completed but its response was too large to retain",
          status: 409,
        };
      case "challenge-invalid":
        return {
          abort: true,
          reason: "payment_replay_binding_required",
          message: "Cardano payment requires the opaque replay challenge from its original 402",
          status: 403,
        };
      case "capacity-exceeded":
        return {
          abort: true,
          reason: "payment_replay_capacity_exceeded",
          message: "the Cardano idempotency store is at capacity",
          status: 503,
        };
      case "in-progress":
        return {
          abort: true,
          reason: "duplicate_settlement",
          message: "the protected operation for this Cardano payment is already in progress",
          status: 409,
        };
      case "ambiguous":
        return {
          abort: true,
          reason: "payment_replay_outcome_ambiguous",
          message: "the protected operation may have completed and requires reconciliation",
          status: 409,
        };
      case "claimed":
        this.replayOwners.set(replayOwner, { key: identity.key, ownerToken });
        return;
    }
  }

  /**
   * Stores the completed handler response after settlement, including pending
   * settlement. A later identical paid retry resumes settlement without
   * running the protected operation again.
   *
   * @param context - Core after-settle hook context.
   * @param context.transportContext - Transport carrying the buffered handler response.
   * @param context.result - Settlement result, when this is a failure hook.
   * @param context.result.errorReason - Stable settlement failure reason.
   */
  private async storeProtectedResult(context: {
    transportContext?: unknown;
    result?: { errorReason?: string };
  }): Promise<void> {
    const transport = this.asReplayTransport(context.transportContext);
    if (!transport) return;
    const owner = this.replayOwner(transport);
    if (!owner) return;
    const claimOwner = this.replayOwners.get(owner);
    if (!claimOwner) return;
    if (context.result?.errorReason === ERR_SETTLEMENT_DEFINITIVELY_REJECTED) {
      await this.operationStore.markAmbiguous(claimOwner.key, claimOwner.ownerToken);
      this.replayOwners.delete(owner);
      return;
    }
    if (transport.responseBody === undefined) {
      await this.operationStore.markAmbiguous(claimOwner.key, claimOwner.ownerToken);
      this.replayOwners.delete(owner);
      return;
    }

    const responseHeaders = transport.responseHeaders ?? {};
    const contentType =
      Object.entries(responseHeaders).find(
        ([name]) => name.toLowerCase() === "content-type",
      )?.[1] ?? "application/octet-stream";
    const replayHeaders = Object.fromEntries(
      Object.entries(responseHeaders).filter(
        ([name]) =>
          name.toLowerCase() !== "content-type" &&
          !NON_REPLAYABLE_RESPONSE_HEADERS.has(name.toLowerCase()),
      ),
    );
    const response: CardanoStoredResponse = {
      status: transport.responseStatus ?? 200,
      contentType,
      headers: replayHeaders,
      body: Buffer.from(transport.responseBody),
      isRaw: true,
    };
    const responseBytes =
      transport.responseBody.byteLength + Buffer.byteLength(JSON.stringify(replayHeaders), "utf8");
    const outcome = await this.operationStore.complete(
      claimOwner.key,
      claimOwner.ownerToken,
      response,
      responseBytes,
    );
    this.replayOwners.delete(owner);
    if (outcome === "not-owner") {
      throw new Error("Cardano operation claim ownership was lost before completion");
    }
  }

  /**
   * Releases only a claim owned by the request whose handler failed. An abort
   * from a concurrent duplicate must not release the original request's claim.
   *
   * @param context - Verified-payment cancellation context.
   */
  private async cancelProtectedOperation(
    context: Parameters<NonNullable<SchemeServerHooks["onVerifiedPaymentCanceled"]>>[0],
  ): Promise<void> {
    const transport = this.asReplayTransport(context.transportContext);
    if (!transport) return;
    const owner = this.replayOwner(transport);
    if (!owner) return;
    const claimOwner = this.replayOwners.get(owner);
    if (!claimOwner) return;
    if (context.reason === "after_verify_aborted") {
      await this.operationStore.release(claimOwner.key, claimOwner.ownerToken);
    } else {
      await this.operationStore.markAmbiguous(claimOwner.key, claimOwner.ownerToken);
    }
    this.replayOwners.delete(owner);
  }

  /**
   * Returns an object transport context suitable for WeakMap ownership.
   *
   * @param value - Untrusted transport context.
   * @returns Object context, when present.
   */
  private asReplayTransport(value: unknown): ReplayTransportContext | undefined {
    return typeof value === "object" && value !== null
      ? (value as ReplayTransportContext)
      : undefined;
  }

  /**
   * Uses the stable request adapter as claim owner across verify and settle.
   *
   * @param transport - Transport context.
   * @returns Stable ownership object.
   */
  private replayOwner(transport: ReplayTransportContext): object | undefined {
    const adapter = transport.request?.adapter;
    return typeof adapter === "object" && adapter !== null ? adapter : undefined;
  }

  /**
   * Computes the logical replay key and canonical transaction id.
   *
   * @param paymentPayload - Verified Cardano payment.
   * @param requirements - Canonical requirements.
   * @returns Replay identity.
   */
  private paymentIdentity(
    paymentPayload: Parameters<
      NonNullable<SchemeServerHooks["onAfterVerify"]>
    >[0]["paymentPayload"],
    requirements: Parameters<NonNullable<SchemeServerHooks["onAfterVerify"]>>[0]["requirements"],
  ): { key: string; txHash: string } {
    const transaction = (paymentPayload.payload as { transaction?: unknown }).transaction;
    if (typeof transaction !== "string") throw new Error("Cardano transaction is missing");
    const decoded = decodeCardanoTransaction(transaction);
    const extra = requirements.extra as Record<string, unknown> | undefined;
    const key =
      extra?.assetTransferMethod === "masumi"
        ? `masumi:${computeTermsDigest(
            buildSignedTerms(
              extra as unknown as CardanoExtraMasumi,
              requirements as unknown as PaymentRequirements,
            ),
          )}`
        : `transaction:${decoded.txHash}`;
    return { key, txHash: decoded.txHash };
  }

  /**
   * Builds a deterministic fingerprint for the protected HTTP operation.
   *
   * @param transport - Transport carrying request data.
   * @returns Lowercase SHA-256 fingerprint.
   */
  private async requestFingerprint(
    transport: ReplayTransportContext,
  ): Promise<{ fingerprint: string; isRequesterAuthenticated: boolean }> {
    const adapter = transport.request?.adapter;
    const method = transport.request?.method ?? adapter?.getMethod?.() ?? "";
    const url = adapter?.getUrl?.() ?? "";
    const contentType = adapter?.getHeader?.("content-type") ?? "";
    const rawBody = await adapter?.getRawBody?.();
    const body = rawBody === undefined ? await adapter?.getBody?.() : undefined;
    const getHeader = (name: string): string | undefined => adapter?.getHeader?.(name);
    const bindingContext: CardanoReplayBindingContext = {
      method,
      url,
      contentType,
      body,
      ...(rawBody !== undefined ? { rawBody } : {}),
      getHeader,
    };
    const defaultBindingValues = DEFAULT_REQUEST_BINDING_HEADERS.map(name => ({
      name,
      value: getHeader(name) ?? "",
    }));
    const requesterBinding = this.requestBinding
      ? await this.requestBinding(bindingContext)
      : defaultBindingValues.map(({ name, value }) => `${name}:${value}`).join("\n");
    // Header presence still contributes to the fingerprint, but only an explicit
    // callback run after upstream authentication proves a requester identity.
    const isRequesterAuthenticated = this.requestBinding
      ? requesterBinding.trim().length > 0
      : false;
    const canonicalBody = await this.canonicalRequestBody(bindingContext);
    const bodyDigest = bytesToHex(sha256(canonicalBody));
    return {
      fingerprint: bytesToHex(
        sha256(
          new TextEncoder().encode(
            jcs({
              method: method.toUpperCase(),
              url,
              contentType,
              bodyDigest,
              requesterBinding,
            }),
          ),
        ),
      ),
      isRequesterAuthenticated,
    };
  }

  /**
   * Returns the canonical fingerprint of one advertised requirement.
   *
   * @param requirements - Requirement to fingerprint.
   * @returns Canonical SHA-256 fingerprint.
   */
  private requirementsFingerprint(requirements: PaymentRequirements): string {
    return bytesToHex(sha256(new TextEncoder().encode(jcs(requirements))));
  }

  /**
   * Reads a challenge for one requirement from the reserved extension.
   *
   * @param extensions - Paid-payload extensions.
   * @param requirementsFingerprint - Requirement fingerprint lookup key.
   * @returns A valid challenge, if present.
   */
  private replayChallenge(
    extensions: Readonly<Record<string, unknown>> | undefined,
    requirementsFingerprint: string,
  ): string | undefined {
    const challenges = this.replayExtension(extensions);
    const challenge = challenges[requirementsFingerprint];
    return typeof challenge === "string" && REPLAY_CHALLENGE_HEX.test(challenge)
      ? challenge
      : undefined;
  }

  /**
   * Reads the closed challenge map from an extension value.
   *
   * @param extensions - Extension object to inspect.
   * @returns Valid challenge entries only.
   */
  private replayExtension(
    extensions: Readonly<Record<string, unknown>> | undefined,
  ): Record<string, string> {
    const value = extensions?.[CARDANO_REPLAY_EXTENSION_KEY];
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    const challenges = (value as { challenges?: unknown }).challenges;
    if (typeof challenges !== "object" || challenges === null || Array.isArray(challenges)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(challenges).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && REPLAY_CHALLENGE_HEX.test(entry[1]),
      ),
    );
  }

  /**
   * Returns unambiguous request-body bytes. Raw bytes win; otherwise a custom
   * serializer or strict plain-JSON canonicalization is required.
   *
   * @param context - Request data available to the replay binder.
   * @returns Exact bytes covered by the request fingerprint.
   */
  private async canonicalRequestBody(context: CardanoReplayBindingContext): Promise<Uint8Array> {
    let result: Uint8Array;
    if (context.rawBody) {
      result = Uint8Array.from(context.rawBody);
    } else if (this.requestBodyBytes) {
      const custom = await this.requestBodyBytes(context);
      result =
        typeof custom === "string" ? new TextEncoder().encode(custom) : Uint8Array.from(custom);
    } else if (context.body === undefined) {
      result = new Uint8Array();
    } else if (context.body instanceof Uint8Array) {
      result = Uint8Array.from(context.body);
    } else {
      assertPlainJson(context.body, this.maxRequestBodyBytes);
      result = new TextEncoder().encode(jcs(context.body));
    }
    if (result.length > this.maxRequestBodyBytes) {
      throw new Error("request body exceeds the replay fingerprint byte limit");
    }
    return result;
  }

  /**
   * Ensures requirements use the same canonical wire forms enforced by the
   * Cardano client and facilitator.
   *
   * @param value - Parsed amount and asset.
   * @param source - Label included in validation errors.
   * @returns The unchanged, validated value.
   */
  private validateAssetAmount(value: AssetAmount, source: string): AssetAmount {
    if (!POSITIVE_CANONICAL_AMOUNT_REGEX.test(value.amount)) {
      throw new Error(`${source} amount must be a positive canonical integer: ${value.amount}`);
    }
    if (!CANONICAL_CARDANO_ASSET_REGEX.test(value.asset)) {
      throw new Error(`${source} asset must use canonical lowercase Cardano form: ${value.asset}`);
    }
    return value;
  }

  /**
   * Parses a Money value (number, or a decimal string with optional `$`) into a
   * decimal number via the shared core parser.
   *
   * @param money - The Money value to parse.
   * @returns The decimal value as a number.
   */
  private parseMoneyToDecimal(money: Money): number {
    if (typeof money === "number") {
      return money;
    }
    return parseMoneyString(money);
  }

  /**
   * Falls back to converting a Money decimal to atomic units on the given
   * network. Honors `getAssetDecimals()` so subclasses that override the
   * hook for non-USDM tokens get correctly scaled atomic amounts.
   *
   * @param amount - The decimal amount.
   * @param network - The Cardano network identifier.
   * @returns The resulting AssetAmount.
   */
  private defaultMoneyConversion(amount: number, network: Network): AssetAmount {
    const asset = getDefaultUsdmAsset(network);
    const decimals = this.getAssetDecimals(asset, network);
    const tokenAmount = convertToTokenAmount(numberToDecimalString(amount), decimals);
    return { amount: tokenAmount, asset, extra: {} };
  }
}
