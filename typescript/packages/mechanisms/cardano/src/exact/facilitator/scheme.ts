import type {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import {
  ASSET_TRANSFER_METHOD_DEFAULT,
  ASSET_TRANSFER_METHOD_MASUMI,
  ASSET_TRANSFER_METHOD_SCRIPT,
  CARDANO_NETWORKS,
  ERR_AMOUNT_INSUFFICIENT,
  ERR_ASSET_MISMATCH,
  ERR_CHAIN_LOOKUP_FAILED,
  ERR_DUPLICATE_SETTLEMENT,
  ERR_INPUT_NOT_AVAILABLE,
  ERR_INVALID_PAYLOAD,
  ERR_INVALID_SIGNATURE,
  ERR_NETWORK_ID_MISMATCH,
  ERR_NETWORK_MISMATCH,
  ERR_NONCE_INVALID,
  ERR_NONCE_NOT_IN_INPUTS,
  ERR_NONCE_NOT_ON_CHAIN,
  ERR_RECIPIENT_MISMATCH,
  ERR_SCRIPT_ADDRESS_MISMATCH,
  ERR_SETTLEMENT_FAILED,
  ERR_SETTLEMENT_NOT_CONFIRMED,
  ERR_TRANSACTION_DECODE_FAILED,
  ERR_TRANSACTION_UNSIGNED,
  ERR_TTL_EXPIRED,
  ERR_UNSUPPORTED_SCHEME,
  ERR_VALIDITY_NOT_YET_VALID,
  getCardanoNetworkId,
  isCardanoNetwork,
  normalizeCardanoNetwork,
  SCHEME_EXACT,
} from "../../constants";
import type {
  CardanoExtra,
  CardanoExtraScript,
  DecodedCardanoTransaction,
  ExactCardanoPayload,
} from "../../types";
import type { CardanoUtxoSnapshot, FacilitatorCardanoSigner } from "../../signer";
import { decodeCardanoPayload, decodeCardanoTransaction, parseUtxoRef } from "../../utils";
import { scriptAddressMatches } from "./scriptAddress";

/**
 * Optional configuration knobs for the Cardano facilitator scheme.
 */
export interface ExactCardanoFacilitatorConfig {
  /**
   * Time-to-live (in milliseconds) for the duplicate-settlement cache. Defaults
   * to two minutes which exceeds typical Cardano slot/block lifetimes.
   */
  duplicateCacheTtlMs?: number;
  /**
   * If `true` the facilitator returns `status: "mempool"` even when the signer
   * confirms inclusion. Default is `false`. Even when enabled the spec
   * strongly discourages granting access on mempool inclusion.
   */
  acceptMempool?: boolean;
}

/**
 * Cardano facilitator implementation for the Exact payment scheme.
 *
 * Performs all checks listed in the "Facilitator Verification Rules" section
 * of `specs/schemes/exact/scheme_exact_cardano.md` (rules 1-6) before
 * accepting a payment. Settlement re-runs verification before submitting.
 *
 * The duplicate-settlement cache is in-process only; across multiple
 * facilitator instances the authoritative replay guard is the on-chain UTXO
 * spend (rule 5), which makes the consumed nonce UTXO fail re-verification.
 */
export class ExactCardanoScheme implements SchemeNetworkFacilitator {
  readonly scheme = SCHEME_EXACT;
  readonly caipFamily = "cardano:*";

  private readonly settlementCache = new Map<string, number>();
  private readonly duplicateCacheTtlMs: number;
  private readonly acceptMempool: boolean;

  /**
   * Creates a new Cardano facilitator scheme.
   *
   * @param signer - The facilitator signer / chain query implementation.
   * @param config - Optional configuration knobs.
   */
  constructor(
    private readonly signer: FacilitatorCardanoSigner,
    config: ExactCardanoFacilitatorConfig = {},
  ) {
    this.duplicateCacheTtlMs = config.duplicateCacheTtlMs ?? 120_000;
    this.acceptMempool = config.acceptMempool ?? false;
  }

  /**
   * Returns extra metadata for the `/supported` endpoint. Cardano payments do
   * not require server-side metadata in `default` mode, but consumers may
   * extend this method in subclasses.
   *
   * @param _network - The Cardano network identifier (unused).
   * @returns Always `undefined` for the default Cardano scheme.
   */
  getExtra(_network: string): Record<string, unknown> | undefined {
    void _network;
    return undefined;
  }

  /**
   * Returns the addresses managed by this facilitator for the supplied
   * network. Used by the `/supported` response.
   *
   * @param _network - The Cardano network identifier.
   * @returns The list of facilitator addresses.
   */
  getSigners(_network: string): string[] {
    void _network;
    return [...this.signer.getAddresses()];
  }

  /**
   * Verifies a Cardano payment against the supplied requirements following
   * the spec's six rules.
   *
   * @param payload - The Cardano payment payload.
   * @param requirements - The payment requirements being fulfilled.
   * @returns A verify response describing success or failure.
   */
  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    try {
      if (payload.x402Version !== 2) {
        return {
          isValid: false,
          invalidReason: `${ERR_INVALID_PAYLOAD}_unsupported_version`,
          payer: "",
        };
      }

      if (payload.accepted.scheme !== SCHEME_EXACT || requirements.scheme !== SCHEME_EXACT) {
        return { isValid: false, invalidReason: ERR_UNSUPPORTED_SCHEME, payer: "" };
      }

      if (
        normalizeCardanoNetwork(payload.accepted.network) !==
        normalizeCardanoNetwork(requirements.network)
      ) {
        return { isValid: false, invalidReason: ERR_NETWORK_MISMATCH, payer: "" };
      }

      if (!isCardanoNetwork(requirements.network)) {
        return { isValid: false, invalidReason: ERR_NETWORK_MISMATCH, payer: "" };
      }

      let cardanoPayload: ExactCardanoPayload;
      try {
        cardanoPayload = decodeCardanoPayload(payload.payload as Record<string, unknown>);
      } catch {
        return { isValid: false, invalidReason: ERR_INVALID_PAYLOAD, payer: "" };
      }

      let parsedNonce: { txHash: string; index: number };
      try {
        parsedNonce = parseUtxoRef(cardanoPayload.nonce);
      } catch {
        return { isValid: false, invalidReason: ERR_NONCE_INVALID, payer: "" };
      }

      let decoded: DecodedCardanoTransaction;
      try {
        decoded = decodeCardanoTransaction(cardanoPayload.transaction);
      } catch (cause) {
        return {
          isValid: false,
          invalidReason: ERR_TRANSACTION_DECODE_FAILED,
          invalidMessage: cause instanceof Error ? cause.message : String(cause),
          payer: "",
        };
      }

      // Rule 1: network validation. When the body declares a network_id it MUST
      // match the declared network. Absence of network_id is permitted: the
      // field is optional in the Cardano CBOR spec and many wallets omit it.
      // Network correctness is still enforced by Rule 3 (payTo address check):
      // Cardano addresses are network-tagged (addr_test1... vs addr1...), so a
      // testnet address cannot be submitted on mainnet and vice versa.
      const expectedNetworkId = getCardanoNetworkId(requirements.network);
      if (decoded.networkId !== undefined && decoded.networkId !== expectedNetworkId) {
        return {
          isValid: false,
          invalidReason: ERR_NETWORK_ID_MISMATCH,
          payer: "",
        };
      }
      // SECURITY: refuse unsigned transactions in verify() so /verify cannot
      // return a false-positive that would let callers grant access on an
      // unpaid request.
      if (decoded.vkeyWitnessCount === 0 && decoded.scriptWitnessCount === 0) {
        return { isValid: false, invalidReason: ERR_TRANSACTION_UNSIGNED, payer: "" };
      }
      if (!decoded.signaturesValid) {
        return { isValid: false, invalidReason: ERR_INVALID_SIGNATURE, payer: "" };
      }

      // Rule 6 (TTL upper bound) AND lower validity bound: when either is
      // declared, fetch the current slot once and check both. The spec only
      // calls out TTL explicitly, but a transaction whose lower bound is in
      // the future is also not yet valid; without this check verify() could
      // return isValid:true even though the chain would refuse the tx.
      if (decoded.ttlSlot !== undefined || decoded.validityStartSlot !== undefined) {
        let currentSlot: bigint;
        try {
          currentSlot = await this.signer.getCurrentSlot(requirements.network);
        } catch (cause) {
          return {
            isValid: false,
            invalidReason: ERR_CHAIN_LOOKUP_FAILED,
            invalidMessage: cause instanceof Error ? cause.message : String(cause),
            payer: "",
          };
        }
        if (decoded.ttlSlot !== undefined && decoded.ttlSlot <= currentSlot) {
          return { isValid: false, invalidReason: ERR_TTL_EXPIRED, payer: "" };
        }
        if (decoded.validityStartSlot !== undefined && decoded.validityStartSlot > currentSlot) {
          return { isValid: false, invalidReason: ERR_VALIDITY_NOT_YET_VALID, payer: "" };
        }
      }

      // Rule 5 (input check): nonce UTXO MUST appear as an input.
      const inputSet = new Set(decoded.inputs.map(i => i.toLowerCase()));
      const nonceLower = `${parsedNonce.txHash.toLowerCase()}#${parsedNonce.index}`;
      if (!inputSet.has(nonceLower)) {
        return { isValid: false, invalidReason: ERR_NONCE_NOT_IN_INPUTS, payer: "" };
      }

      // Rule 5 (chain check) + on-chain pre-check: EVERY transaction input MUST
      // currently be unspent. A spent input — the nonce or any coin-selected
      // input — guarantees the chain rejects the transaction at submission, so
      // resolve them all here rather than only validating payload structure.
      let inputSnapshots: CardanoUtxoSnapshot[];
      try {
        inputSnapshots = await Promise.all(
          decoded.inputs.map(ref => this.signer.getUtxo(ref, requirements.network)),
        );
      } catch (cause) {
        return {
          isValid: false,
          invalidReason: ERR_CHAIN_LOOKUP_FAILED,
          invalidMessage: cause instanceof Error ? cause.message : String(cause),
          payer: "",
        };
      }

      const nonceSnapshot =
        inputSnapshots[decoded.inputs.findIndex(ref => ref.toLowerCase() === nonceLower)];
      if (!nonceSnapshot?.exists) {
        return { isValid: false, invalidReason: ERR_NONCE_NOT_ON_CHAIN, payer: "" };
      }

      const payer = nonceSnapshot.address ?? "";

      // Any other input being spent means the transaction cannot settle.
      if (inputSnapshots.some(snapshot => !snapshot.exists)) {
        return { isValid: false, invalidReason: ERR_INPUT_NOT_AVAILABLE, payer };
      }

      // Rules 2, 3, 4: at least one output MUST pay the requested amount of
      // the requested asset to the requested address. Lovelace is special-
      // cased because native ADA lives in `output.coin` rather than the
      // multi-asset map.
      const requestedAmount = BigInt(requirements.amount);
      const assetKey = requirements.asset.toLowerCase();
      const isLovelace = assetKey === "lovelace";
      let recipientFound = false;
      let assetFoundForRecipient = false;
      let bestAvailable = 0n;

      for (const output of decoded.outputs) {
        if (output.address !== requirements.payTo) {
          continue;
        }
        recipientFound = true;
        const available = isLovelace ? output.coin : output.assets[assetKey];
        if (available === undefined) {
          continue;
        }
        assetFoundForRecipient = true;
        if (available > bestAvailable) bestAvailable = available;
        if (available >= requestedAmount) {
          // SECURITY: Read assetTransferMethod from the canonical
          // server-supplied requirements, NOT from payload.accepted.extra
          // (which is client-echoed and could lie about the method to
          // bypass script-mode reconstruction checks).
          const methodCheck = await this.runMethodSpecificChecks(
            requirements.extra,
            requirements.payTo,
            payer,
          );
          if (!methodCheck.ok) {
            return { isValid: false, invalidReason: methodCheck.reason, payer };
          }
          // Optional Plutus-script dry-run. `evaluateTransaction` computes
          // script execution units (Ogmios evaluateTransaction / Blockfrost
          // /utils/txs/evaluate); it does NOT validate vkey signatures. It only
          // adds a guard for script-mode payments, so it is a no-op for the
          // simple address-to-address transfers this base class accepts.
          // Skipped when the signer does not implement it; either way vkey
          // signatures are enforced only by the node at submit time (settle).
          if (typeof this.signer.evaluateTransaction === "function") {
            try {
              await this.signer.evaluateTransaction(
                cardanoPayload.transaction,
                requirements.network,
              );
            } catch (cause) {
              return {
                isValid: false,
                invalidReason: ERR_CHAIN_LOOKUP_FAILED,
                invalidMessage: cause instanceof Error ? cause.message : String(cause),
                payer,
              };
            }
          }
          return { isValid: true, payer };
        }
      }

      if (!recipientFound) {
        return { isValid: false, invalidReason: ERR_RECIPIENT_MISMATCH, payer };
      }
      if (!assetFoundForRecipient) {
        return { isValid: false, invalidReason: ERR_ASSET_MISMATCH, payer };
      }
      return {
        isValid: false,
        invalidReason: ERR_AMOUNT_INSUFFICIENT,
        invalidMessage: `output to ${requirements.payTo} pays ${bestAvailable}, requires ${requestedAmount}`,
        payer,
      };
    } catch (error) {
      return {
        isValid: false,
        invalidReason: `${ERR_INVALID_PAYLOAD}_verification_error`,
        invalidMessage: error instanceof Error ? error.message : String(error),
        payer: "",
      };
    }
  }

  /**
   * Settles a Cardano payment by re-verifying and submitting the transaction.
   *
   * @param payload - The Cardano payment payload.
   * @param requirements - The payment requirements.
   * @returns A settle response describing success or failure.
   */
  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const verifyResult = await this.verify(payload, requirements);
    if (!verifyResult.isValid) {
      return {
        success: false,
        errorReason: verifyResult.invalidReason ?? "verification_failed",
        transaction: "",
        network: payload.accepted.network,
      };
    }

    const cardanoPayload = decodeCardanoPayload(payload.payload as Record<string, unknown>);
    const cacheKey = cardanoPayload.transaction;
    // Atomically claim the cache key so concurrent settle() calls do not all
    // pass the duplicate check before the first await on submitTransaction().
    if (!this.tryClaim(cacheKey)) {
      return {
        success: false,
        errorReason: ERR_DUPLICATE_SETTLEMENT,
        transaction: "",
        network: payload.accepted.network,
      };
    }

    try {
      const submission = await this.signer.submitTransaction(
        cardanoPayload.transaction,
        requirements.network,
      );

      // Honor `acceptMempool`: when the signer reports only mempool inclusion
      // and the operator has not opted in, refuse to call the payment settled.
      // We keep the claim in place even on rejection so retries cannot
      // rebroadcast the same transaction repeatedly.
      if (submission.status !== "confirmed" && !this.acceptMempool) {
        return {
          success: false,
          errorReason: ERR_SETTLEMENT_NOT_CONFIRMED,
          transaction: submission.txHash,
          network: payload.accepted.network,
          payer: verifyResult.payer,
          extra: { status: submission.status },
        };
      }

      return {
        success: true,
        transaction: submission.txHash,
        network: payload.accepted.network,
        payer: verifyResult.payer,
        extra: { status: submission.status },
      };
    } catch {
      // Submission threw (network error, deserialization error, etc.). Free
      // the claim so the caller can retry with a corrected payload.
      this.releaseClaim(cacheKey);
      return {
        success: false,
        errorReason: ERR_SETTLEMENT_FAILED,
        transaction: "",
        network: payload.accepted.network,
      };
    }
  }

  /**
   * Runs the verification step that depends on the assetTransferMethod
   * declared in `requirements.extra`.
   *
   * - `default` / undefined: no extra verification beyond the asset+amount+
   *   address checks performed by the caller.
   * - `masumi`: the spec does not require additional on-chain verification
   *   beyond the transfer itself; integrators wishing to enforce extra Masumi
   *   invariants can subclass and override this method.
   * - `script`: the facilitator reconstructs the script credential from the
   *   declared `script` (+ parameters) or `scriptHash` and confirms it equals
   *   the script payment credential of `requirements.payTo`. A non-script
   *   `payTo`, a missing descriptor, or a mismatch is rejected.
   *
   * @param extra - The accepted requirements' extra block.
   * @param payTo - The recipient address declared in the payment requirements.
   * @param payer - The payer address (passed through for context).
   * @returns Result describing success or a precise failure reason.
   */
  protected async runMethodSpecificChecks(
    extra: Record<string, unknown> | undefined,
    payTo: string,
    payer: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    void payer;
    const method =
      (extra as CardanoExtra | undefined)?.assetTransferMethod ?? ASSET_TRANSFER_METHOD_DEFAULT;
    if (method === ASSET_TRANSFER_METHOD_DEFAULT || method === ASSET_TRANSFER_METHOD_MASUMI) {
      return { ok: true };
    }
    if (method === ASSET_TRANSFER_METHOD_SCRIPT) {
      const scriptExtra = extra as CardanoExtraScript;
      if (!scriptExtra.scriptHash && !scriptExtra.script) {
        return { ok: false, reason: ERR_SCRIPT_ADDRESS_MISMATCH };
      }
      // SECURITY: confirm payTo is the script address implied by the declared
      // script + parameters (or scriptHash), so a server cannot redirect the
      // payment to an address unrelated to the advertised script.
      if (!scriptAddressMatches(scriptExtra, payTo)) {
        return { ok: false, reason: ERR_SCRIPT_ADDRESS_MISMATCH };
      }
      return { ok: true };
    }
    return { ok: false, reason: ERR_UNSUPPORTED_SCHEME };
  }

  /**
   * Atomically claim a cache key for an in-flight or completed settlement.
   * Synchronous so concurrent settle() calls cannot all race past the check.
   *
   * @param key - Cache key, typically the base64-encoded transaction.
   * @returns True when the claim was acquired; false when the key was already
   *   claimed within the duplicate-settlement window.
   */
  private tryClaim(key: string): boolean {
    const seenAt = this.settlementCache.get(key);
    const now = Date.now();
    if (seenAt !== undefined && now - seenAt <= this.duplicateCacheTtlMs) {
      return false;
    }
    this.settlementCache.set(key, now);
    if (this.settlementCache.size > 1024) {
      const cutoff = now - this.duplicateCacheTtlMs;
      for (const [k, t] of this.settlementCache) {
        if (t < cutoff) this.settlementCache.delete(k);
      }
    }
    return true;
  }

  /**
   * Releases a previously-claimed cache key so retries can attempt
   * settlement again. Called when submission throws a transient error.
   *
   * @param key - Cache key, typically the base64-encoded transaction.
   * @returns Nothing.
   */
  private releaseClaim(key: string): void {
    this.settlementCache.delete(key);
  }
}

/**
 * Convenience helper exposing the list of networks this scheme supports.
 *
 * @returns The supported Cardano CAIP-style network identifiers.
 */
export function supportedCardanoNetworks(): readonly string[] {
  return CARDANO_NETWORKS;
}
