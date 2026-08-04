import type {
  AssetAmount,
  Money,
  MoneyParser,
  Network,
  PaymentRequirements,
  Price,
  SchemeNetworkServer,
  SchemeServerHooks,
  SupportedKind,
} from "@x402/core/types";
import { sha256 } from "@noble/hashes/sha2.js";
import { convertToTokenAmount, numberToDecimalString, parseMoneyString } from "@x402/core/utils";
import { randomBytes } from "node:crypto";
import {
  CANONICAL_CARDANO_ASSET_REGEX,
  POSITIVE_CANONICAL_AMOUNT_REGEX,
  getDefaultUsdmAsset,
  isCardanoNetwork,
  SCHEME_EXACT,
  USDM_DEFAULT_DECIMALS,
} from "../../constants";
import type { CardanoExtraMasumi } from "../../types";
import { decodeCardanoTransaction, slotToPosixMs } from "../../utils";
import {
  InMemoryCardanoOperationStore,
  type CardanoOperationStore,
  type CardanoStoredResponse,
  type InMemoryCardanoOperationStoreOptions,
} from "../../idempotency";
import { buildSignedTerms, computeTermsDigest } from "../masumi/digests";
import { jcs } from "../masumi/jcs";

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
      getBody?(): unknown;
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
  "content-length",
  "payment-response",
  "proxy-authenticate",
  "set-cookie",
  "settlement-overrides",
  "transfer-encoding",
  "www-authenticate",
]);

const DEFAULT_REQUEST_BINDING_HEADERS = ["authorization", "cookie", "x-api-key"] as const;

/** Request data available to an application-specific replay-binding callback. */
export interface CardanoReplayBindingContext {
  method: string;
  url: string;
  contentType: string;
  body: unknown;
  getHeader(name: string): string | undefined;
}

/** Cardano resource-server replay configuration. */
export interface ExactCardanoServerConfig {
  /**
   * Atomic idempotency store. A shared implementation is required when the
   * resource server runs in more than one worker or process.
   */
  operationStore?: CardanoOperationStore;
  /** Capacity settings for the default process-local store. */
  inMemoryStore?: InMemoryCardanoOperationStoreOptions;
  /**
   * Returns the authenticated principal/tenant binding for a paid request.
   * Authentication must run before the x402 middleware. When absent, the
   * standard authorization, cookie and x-api-key headers are bound instead.
   */
  requestBinding?: (context: CardanoReplayBindingContext) => string | Promise<string>;
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
  private readonly replayOwners = new WeakMap<object, HandlerReplayOwner>();

  /**
   * Creates a server scheme with its Cardano replay lifecycle hooks.
   *
   * @param config - Replay persistence, capacity and requester-binding options.
   */
  constructor(config: ExactCardanoServerConfig = {}) {
    this.operationStore =
      config.operationStore ?? new InMemoryCardanoOperationStore(config.inMemoryStore);
    this.requestBinding = config.requestBinding;
    this.schemeHooks = {
      onAfterVerify: async context => this.claimProtectedOperation(context),
      onAfterSettle: async context => this.storeProtectedResult(context),
      onSettleFailure: async context => this.storeProtectedResult(context),
      onVerifiedPaymentCanceled: async context => this.releaseProtectedOperation(context),
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
  enhancePaymentRequirements(
    paymentRequirements: PaymentRequirements,
    supportedKind: SupportedKind,
    extensionKeys: string[],
  ): Promise<PaymentRequirements> {
    void extensionKeys;
    if (!isCardanoNetwork(supportedKind.network)) {
      throw new Error(`Unsupported Cardano network: ${supportedKind.network}`);
    }
    return Promise.resolve(paymentRequirements);
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

    let identity: { key: string; txHash: string; expiresAt: number };
    try {
      identity = this.paymentIdentity(context.paymentPayload, context.requirements);
    } catch (cause) {
      return {
        abort: true,
        reason: "invalid_exact_cardano_payload",
        message: cause instanceof Error ? cause.message : String(cause),
      };
    }
    const fingerprint = await this.requestFingerprint(transport);
    const ownerToken = randomBytes(16).toString("hex");
    const claim = await this.operationStore.claim({
      ...identity,
      fingerprint,
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
      case "claimed":
        this.replayOwners.set(this.replayOwner(transport), { key: identity.key, ownerToken });
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
   */
  private async storeProtectedResult(context: { transportContext?: unknown }): Promise<void> {
    const transport = this.asReplayTransport(context.transportContext);
    if (!transport) return;
    const owner = this.replayOwner(transport);
    const claimOwner = this.replayOwners.get(owner);
    if (!claimOwner || !transport.responseBody) return;

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
    const isJson = contentType.toLowerCase().includes("application/json");
    let body: Buffer | unknown = Buffer.from(transport.responseBody);
    if (isJson) {
      try {
        body = JSON.parse(transport.responseBody.toString("utf8"));
      } catch {
        // A malformed JSON response must still replay byte-for-byte.
      }
    }
    const response: CardanoStoredResponse = {
      status: transport.responseStatus ?? 200,
      contentType,
      headers: replayHeaders,
      body,
      isRaw: !isJson || Buffer.isBuffer(body),
    };
    const responseBytes =
      transport.responseBody.byteLength + Buffer.byteLength(JSON.stringify(replayHeaders), "utf8");
    await this.operationStore.complete(
      claimOwner.key,
      claimOwner.ownerToken,
      response,
      responseBytes,
    );
    this.replayOwners.delete(owner);
  }

  /**
   * Releases only a claim owned by the request whose handler failed. An abort
   * from a concurrent duplicate must not release the original request's claim.
   *
   * @param context - Verified-payment cancellation context.
   */
  private async releaseProtectedOperation(
    context: Parameters<NonNullable<SchemeServerHooks["onVerifiedPaymentCanceled"]>>[0],
  ): Promise<void> {
    const transport = this.asReplayTransport(context.transportContext);
    if (!transport) return;
    const owner = this.replayOwner(transport);
    const claimOwner = this.replayOwners.get(owner);
    if (!claimOwner) return;
    await this.operationStore.release(claimOwner.key, claimOwner.ownerToken);
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
  private replayOwner(transport: ReplayTransportContext): object {
    return transport.request?.adapter ?? transport;
  }

  /**
   * Computes the logical replay key, canonical transaction id and retention.
   *
   * @param paymentPayload - Verified Cardano payment.
   * @param requirements - Canonical requirements.
   * @returns Replay identity and expiry.
   */
  private paymentIdentity(
    paymentPayload: Parameters<
      NonNullable<SchemeServerHooks["onAfterVerify"]>
    >[0]["paymentPayload"],
    requirements: Parameters<NonNullable<SchemeServerHooks["onAfterVerify"]>>[0]["requirements"],
  ): { key: string; txHash: string; expiresAt: number } {
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
    const now = Date.now();
    const fallback = now + requirements.maxTimeoutSeconds * 1000 + 600_000;
    let expiresAt = fallback;
    if (decoded.ttlSlot !== undefined) {
      try {
        expiresAt = Math.max(
          fallback,
          slotToPosixMs(requirements.network, decoded.ttlSlot) + 600_000,
        );
      } catch {
        // The verified facilitator already validated the network and TTL.
      }
    }
    return { key, txHash: decoded.txHash, expiresAt };
  }

  /**
   * Builds a deterministic fingerprint for the protected HTTP operation.
   *
   * @param transport - Transport carrying request data.
   * @returns Lowercase SHA-256 fingerprint.
   */
  private async requestFingerprint(transport: ReplayTransportContext): Promise<string> {
    const adapter = transport.request?.adapter;
    const method = transport.request?.method ?? adapter?.getMethod?.() ?? "";
    const url = adapter?.getUrl?.() ?? "";
    const contentType = adapter?.getHeader?.("content-type") ?? "";
    const body = adapter?.getBody?.();
    const getHeader = (name: string): string | undefined => adapter?.getHeader?.(name);
    const bindingContext: CardanoReplayBindingContext = {
      method,
      url,
      contentType,
      body,
      getHeader,
    };
    const requesterBinding = this.requestBinding
      ? await this.requestBinding(bindingContext)
      : DEFAULT_REQUEST_BINDING_HEADERS.map(name => `${name}:${getHeader(name) ?? ""}`).join("\n");
    let canonicalBody = "";
    if (body !== undefined) {
      try {
        canonicalBody = jcs(body);
      } catch {
        try {
          canonicalBody =
            JSON.stringify(body, (_key, value) =>
              typeof value === "bigint" ? value.toString() : value,
            ) ?? String(body);
        } catch {
          canonicalBody = Object.prototype.toString.call(body);
        }
      }
    }
    return bytesToHex(
      sha256(
        new TextEncoder().encode(
          `${method.toUpperCase()}\n${url}\n${contentType}\n${canonicalBody}\n${requesterBinding}`,
        ),
      ),
    );
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
