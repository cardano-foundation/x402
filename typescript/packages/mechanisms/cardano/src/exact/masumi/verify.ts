import type { PaymentRequirements } from "@x402/core/types";

import {
  ERR_MASUMI_CONTRACT_MISMATCH,
  ERR_MASUMI_DATUM_INVALID,
  ERR_MASUMI_DATUM_MISMATCH,
  ERR_MASUMI_DATUM_MISSING,
} from "../../constants";
import type { CardanoExtraMasumi, DecodedCardanoTransaction } from "../../types";
import {
  addressCredentials,
  MASUMI_STATE_FUNDS_LOCKED,
  parseMasumiLockDatum,
  type MasumiAddressCredentials,
} from "./datum";

type Check = { ok: true } | { ok: false; reason: string };

/**
 * Builds a rejection result carrying the failure reason.
 *
 * @param reason - The failure reason code.
 * @returns A failing check.
 */
const fail = (reason: string): Check => ({ ok: false, reason });

/**
 * Whether two addresses share the same payment (and stake, if any) credential.
 *
 * @param a - The first address' credentials.
 * @param b - The second address' credentials.
 * @returns True when the payment and stake credentials match.
 */
function sameCredentials(a: MasumiAddressCredentials, b: MasumiAddressCredentials): boolean {
  if (a.payment.hash !== b.payment.hash || a.payment.isScript !== b.payment.isScript) return false;
  return (a.stake?.hash ?? "") === (b.stake?.hash ?? "");
}

/**
 * Verifies that a payment locks funds into the Masumi `vested_pay` escrow with a
 * well-formed `FundsLocked` datum matching the requirements. Only the on-chain
 * lock is checked (x402's scope); the post-lock lifecycle is out of scope.
 *
 * @param extra - The masumi `extra` block from the canonical requirements.
 * @param requirements - The canonical payment requirements.
 * @param decoded - The decoded transaction (with output inline datums).
 * @param payer - The resolved payer (buyer) address.
 * @returns `{ ok: true }` when the lock is valid, else a precise failure reason.
 */
export function verifyMasumiLock(
  extra: CardanoExtraMasumi,
  requirements: PaymentRequirements,
  decoded: DecodedCardanoTransaction,
  payer: string,
): Check {
  // 1. payTo must equal the deployment's escrow address, which the server
  //    declares in `extra.contractAddress` (from the purchase). Not defaulted:
  //    locking to a wrong escrow silently strands the funds.
  if (!extra.contractAddress || requirements.payTo !== extra.contractAddress) {
    return fail(ERR_MASUMI_CONTRACT_MISMATCH);
  }

  // 2. Locate the escrow output (>= amount) carrying an inline datum.
  const requested = BigInt(requirements.amount);
  const output = decoded.outputs.find(
    o => o.address === requirements.payTo && o.coin >= requested && o.datum !== undefined,
  );
  if (!output || output.datum === undefined) {
    return fail(ERR_MASUMI_DATUM_MISSING);
  }
  const view = parseMasumiLockDatum(output.datum);
  if (!view) {
    return fail(ERR_MASUMI_DATUM_INVALID);
  }

  // 3. Structural invariants of a fresh lock (the validator never checks these on
  //    lock, so a wrong datum would strand funds — reject up front).
  if (view.state !== MASUMI_STATE_FUNDS_LOCKED) return fail(ERR_MASUMI_DATUM_INVALID);
  if (view.resultHash !== "") return fail(ERR_MASUMI_DATUM_INVALID);
  if (view.collateralReturnLovelace < 0n) return fail(ERR_MASUMI_DATUM_INVALID);
  if (view.buyer.payment.isScript || view.seller.payment.isScript) {
    return fail(ERR_MASUMI_DATUM_INVALID);
  }
  // reference_signature: >= 16 bytes (32 hex chars).
  if (view.referenceSignature.length < 32) return fail(ERR_MASUMI_DATUM_INVALID);
  // Time ordering: pay_by <= submit_result <= unlock <= external_dispute_unlock.
  if (
    view.payByTime > view.submitResultTime ||
    view.submitResultTime > view.unlockTime ||
    view.unlockTime > view.externalDisputeUnlockTime
  ) {
    return fail(ERR_MASUMI_DATUM_INVALID);
  }

  // 4. Field matching against the canonical requirements' extra.
  //    buyer MUST be the payer; seller MUST be the declared seller.
  if (!sameCredentials(view.buyer, addressCredentials(payer))) {
    return fail(ERR_MASUMI_DATUM_MISMATCH);
  }
  if (!sameCredentials(view.seller, addressCredentials(extra.sellerAddress))) {
    return fail(ERR_MASUMI_DATUM_MISMATCH);
  }
  // Server-declared datum fields, when present, MUST match the datum. Fields the
  // server omits are client-filled (random/default) and only invariant-checked.
  const mismatches: Array<[string | undefined, string]> = [
    [extra.referenceKey, view.referenceKey],
    [extra.referenceSignature, view.referenceSignature],
    [extra.sellerNonce, view.sellerNonce],
    [extra.identifierFromPurchaser, view.buyerNonce],
    [extra.agentIdentifier, view.agentIdentifier],
    [extra.inputHash, view.inputHash],
  ];
  for (const [declared, actual] of mismatches) {
    if (declared !== undefined && declared.toLowerCase() !== actual) {
      return fail(ERR_MASUMI_DATUM_MISMATCH);
    }
  }
  const timeMismatch: Array<[string | undefined, bigint]> = [
    [extra.payByTime, view.payByTime],
    [extra.submitResultTime, view.submitResultTime],
    [extra.unlockTime, view.unlockTime],
    [extra.externalDisputeUnlockTime, view.externalDisputeUnlockTime],
  ];
  for (const [declared, actual] of timeMismatch) {
    if (declared !== undefined && BigInt(declared) !== actual) {
      return fail(ERR_MASUMI_DATUM_MISMATCH);
    }
  }
  if (
    extra.collateralReturnLovelace !== undefined &&
    BigInt(extra.collateralReturnLovelace) !== view.collateralReturnLovelace
  ) {
    return fail(ERR_MASUMI_DATUM_MISMATCH);
  }

  return { ok: true };
}
