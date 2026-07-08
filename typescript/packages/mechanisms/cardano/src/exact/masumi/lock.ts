import { InlineDatum } from "@evolution-sdk/evolution";

import type { CardanoExtraMasumi } from "../../types";
import { MASUMI_DEFAULT_COLLATERAL_LOVELACE } from "./constants";
import { buildMasumiLockDatum, inlineDatum } from "./datum";

/**
 * Reads a required masumi `extra` field, throwing when it is missing or empty.
 * These values are purchase-bound (supplied from the Masumi purchase); the
 * client must not invent them, so an absent value is a caller error.
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
 * Builds the Masumi `vested_pay` lock inline datum from the payment `extra`.
 * Only `input_hash` (empty) and `collateral_return_lovelace` (0) fall back to
 * the contract defaults; all other fields are required.
 *
 * @param extra - The masumi `extra` block from the payment requirements.
 * @param buyerAddress - The payer wallet bech32 address (datum `buyer`).
 * @returns The inline datum for the escrow output.
 */
export function buildMasumiLockInline(
  extra: CardanoExtraMasumi,
  buyerAddress: string,
): InlineDatum.InlineDatum {
  const datum = buildMasumiLockDatum({
    buyerAddress,
    sellerAddress: requireMasumiField(extra, "sellerAddress"),
    buyerReturnAddress: extra.buyerReturnAddress,
    sellerReturnAddress: extra.sellerReturnAddress,
    referenceKey: requireMasumiField(extra, "referenceKey"),
    referenceSignature: requireMasumiField(extra, "referenceSignature"),
    sellerNonce: requireMasumiField(extra, "sellerNonce"),
    buyerNonce: requireMasumiField(extra, "identifierFromPurchaser"),
    agentIdentifier: requireMasumiField(extra, "agentIdentifier"),
    collateralReturnLovelace:
      extra.collateralReturnLovelace !== undefined
        ? BigInt(extra.collateralReturnLovelace)
        : MASUMI_DEFAULT_COLLATERAL_LOVELACE,
    inputHash: extra.inputHash ?? "",
    payByTime: BigInt(requireMasumiField(extra, "payByTime")),
    submitResultTime: BigInt(requireMasumiField(extra, "submitResultTime")),
    unlockTime: BigInt(requireMasumiField(extra, "unlockTime")),
    externalDisputeUnlockTime: BigInt(requireMasumiField(extra, "externalDisputeUnlockTime")),
  });
  return inlineDatum(datum);
}
