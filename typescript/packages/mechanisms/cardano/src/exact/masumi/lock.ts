import { InlineDatum } from "@evolution-sdk/evolution";

import type { CardanoExtraMasumi } from "../../types";
import { MASUMI_DEFAULT_COLLATERAL_LOVELACE } from "./constants";
import { buildMasumiLockDatum, inlineDatum } from "./datum";

/**
 * Buyer-side datum inputs the client contributes to the lock. The resource
 * server cannot supply these — it issues the 402 for an unauthenticated request
 * and so knows neither the payer nor its purchase. A client integrated with a
 * Masumi Payment Service passes the purchase's values; otherwise the nonce is
 * generated fresh and the rest fall back to the contract defaults.
 */
export interface MasumiBuyerInput {
  /**
   * datum `buyer_nonce` — Masumi's `identifierFromPurchaser`, a **14–26
   * character** hex string. A real integration MUST pass the nonce its purchase
   * was created with (the same value used for `/start_job` and the seller's
   * `POST /payment`); a lock carrying any other nonce binds to no purchase.
   * Defaults to a fresh random nonce, which is enough for a structurally valid
   * lock but is NOT tied to a Masumi purchase.
   */
  identifierFromPurchaser?: string;
  /**
   * datum `input_hash` (hex). Defaults to empty.
   */
  inputHash?: string;
  /**
   * datum `buyer_return_address`. Defaults to absent (`None`).
   */
  buyerReturnAddress?: string;
}

/**
 * Reads a required masumi `extra` field, throwing when it is missing or empty.
 * These values are purchase-bound (supplied from the seller's Masumi payment
 * request); the client must not invent them, so an absent value is a caller
 * error.
 *
 * @param extra - The masumi `extra` block.
 * @param key - The required field name.
 * @returns The field value.
 */
function requireMasumiField(extra: CardanoExtraMasumi, key: keyof CardanoExtraMasumi): string {
  const value = extra[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Masumi payment requires "${String(key)}" in requirements.extra`);
  }
  return value;
}

/**
 * Bytes of buyer nonce generated when the client supplies none. Masumi's
 * `identifierFromPurchaser` is validated as a **14–26 character** hex string
 * (`createPurchaseInitSchemaInput` / `createPaymentsSchemaInput`), so 13 bytes
 * lands exactly on the 26-character maximum.
 */
const MASUMI_BUYER_NONCE_BYTES = 13;

/**
 * Generates a random hex nonce within Masumi's accepted length range.
 *
 * @param bytes - Number of random bytes.
 * @returns The lowercase hex encoding.
 */
function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Builds the Masumi `vested_pay` lock inline datum. Seller-side identifiers and
 * the time bounds come from the server's `extra` and are required; the
 * buyer-side fields come from `buyerInput`, falling back to anything the server
 * chose to declare and then to the contract defaults.
 *
 * @param extra - The masumi `extra` block from the payment requirements.
 * @param buyerAddress - The payer wallet bech32 address (datum `buyer`).
 * @param buyerInput - Buyer-side datum inputs supplied by the client.
 * @returns The inline datum for the escrow output.
 */
export function buildMasumiLockInline(
  extra: CardanoExtraMasumi,
  buyerAddress: string,
  buyerInput: MasumiBuyerInput = {},
): InlineDatum.InlineDatum {
  const datum = buildMasumiLockDatum({
    buyerAddress,
    sellerAddress: requireMasumiField(extra, "sellerAddress"),
    buyerReturnAddress: buyerInput.buyerReturnAddress ?? extra.buyerReturnAddress,
    sellerReturnAddress: extra.sellerReturnAddress,
    referenceKey: requireMasumiField(extra, "referenceKey"),
    referenceSignature: requireMasumiField(extra, "referenceSignature"),
    sellerNonce: requireMasumiField(extra, "sellerNonce"),
    buyerNonce:
      buyerInput.identifierFromPurchaser ??
      extra.identifierFromPurchaser ??
      randomHex(MASUMI_BUYER_NONCE_BYTES),
    agentIdentifier: requireMasumiField(extra, "agentIdentifier"),
    collateralReturnLovelace:
      extra.collateralReturnLovelace !== undefined
        ? BigInt(extra.collateralReturnLovelace)
        : MASUMI_DEFAULT_COLLATERAL_LOVELACE,
    inputHash: buyerInput.inputHash ?? extra.inputHash ?? "",
    payByTime: BigInt(requireMasumiField(extra, "payByTime")),
    submitResultTime: BigInt(requireMasumiField(extra, "submitResultTime")),
    unlockTime: BigInt(requireMasumiField(extra, "unlockTime")),
    externalDisputeUnlockTime: BigInt(requireMasumiField(extra, "externalDisputeUnlockTime")),
  });
  return inlineDatum(datum);
}
