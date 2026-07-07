import type { PaymentRequirements } from "@x402/core/types";

import {
  ERR_MASUMI_ASSET,
  ERR_MASUMI_COLLATERAL,
  ERR_MASUMI_CONTRACT_MISMATCH,
  ERR_MASUMI_DATUM_INVALID,
  ERR_MASUMI_DATUM_MISMATCH,
  ERR_MASUMI_DATUM_MISSING,
  ERR_MASUMI_DEADLINE,
  ERR_MASUMI_MIN_UTXO,
  ERR_MASUMI_REFERENCE_SCRIPT,
  LOVELACE_ASSET,
} from "../../constants";
import type { CardanoExtraMasumi, DecodedCardanoTransaction } from "../../types";
import { slotToPosixMs } from "../../utils";
import { MASUMI_MIN_COLLATERAL_LOVELACE, masumiMinUtxoLovelace } from "./constants";
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
 * Whether the datum's optional return address exactly matches the declared one:
 * a declared address must be present in the datum with matching credentials; an
 * omitted one must be absent (`None`).
 *
 * @param declared - The `extra` return address (bech32), or undefined.
 * @param actual - The datum's return-address credentials, or null (`None`).
 * @returns True when they correspond exactly.
 */
function returnAddressMatches(
  declared: string | undefined,
  actual: MasumiAddressCredentials | null,
): boolean {
  if (declared === undefined) return actual === null;
  return actual !== null && sameCredentials(actual, addressCredentials(declared));
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
 * @param coinsPerUtxoByte - Live `coinsPerUtxoByte`; when supplied, the escrow
 *   output is checked against the post-result min-UTXO. Skipped when absent.
 * @returns `{ ok: true }` when the lock is valid, else a precise failure reason.
 */
export function verifyMasumiLock(
  extra: CardanoExtraMasumi,
  requirements: PaymentRequirements,
  decoded: DecodedCardanoTransaction,
  payer: string,
  coinsPerUtxoByte?: bigint,
): Check {
  // 1. payTo must equal the deployment's escrow address, which the server
  //    declares in `extra.contractAddress` (from the purchase). Not defaulted:
  //    locking to a wrong escrow silently strands the funds.
  if (!extra.contractAddress || requirements.payTo !== extra.contractAddress) {
    return fail(ERR_MASUMI_CONTRACT_MISMATCH);
  }

  // 2. Locate the escrow output paying payTo and carrying an inline datum.
  const output = decoded.outputs.find(
    o => o.address === requirements.payTo && o.datum !== undefined,
  );
  if (!output || output.datum === undefined) {
    return fail(ERR_MASUMI_DATUM_MISSING);
  }
  const datumHex = output.datum;
  // The escrow output must NOT carry a reference script — Masumi treats a set
  // `reference_script_hash` as a spoofing attempt (FundsOrDatumInvalid).
  if (output.hasReferenceScript) {
    return fail(ERR_MASUMI_REFERENCE_SCRIPT);
  }
  const view = parseMasumiLockDatum(datumHex);
  if (!view) {
    return fail(ERR_MASUMI_DATUM_INVALID);
  }

  // 3. Structural invariants of a fresh lock. The validator never checks these
  //    on lock and Masumi validates them off-chain, so any mismatch strands the
  //    funds on a purchase Masumi then invalidates — reject up front.
  if (view.state !== MASUMI_STATE_FUNDS_LOCKED) return fail(ERR_MASUMI_DATUM_INVALID);
  if (view.resultHash !== "") return fail(ERR_MASUMI_DATUM_INVALID);
  // Fresh lock: both cooldown timers MUST be 0 (a non-zero value is spoofing).
  if (view.sellerCooldownTime !== 0n || view.buyerCooldownTime !== 0n) {
    return fail(ERR_MASUMI_DATUM_INVALID);
  }
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

  // 4. Deadline: the tx MUST carry a validity upper bound (TTL) on/before
  //    pay_by_time, so it cannot settle past the deadline — Masumi flags a lock
  //    landing after pay_by_time FundsOrDatumInvalid.
  if (decoded.ttlSlot === undefined) return fail(ERR_MASUMI_DEADLINE);
  if (BigInt(slotToPosixMs(requirements.network, decoded.ttlSlot)) > view.payByTime) {
    return fail(ERR_MASUMI_DEADLINE);
  }

  // 5. Value: collateral bounds + asset/amount (mirrors Masumi's
  //    checkPaymentAmountsMatch). collateral_return_lovelace is denominated in
  //    lovelace and bounded against the locked lovelace for every asset — a
  //    collateral above the locked ADA bricks the seller's on-chain spend paths.
  const collateral = view.collateralReturnLovelace;
  if (
    collateral < 0n ||
    (collateral > 0n && collateral < MASUMI_MIN_COLLATERAL_LOVELACE) ||
    collateral > output.coin
  ) {
    return fail(ERR_MASUMI_COLLATERAL);
  }
  const amount = BigInt(requirements.amount);
  const assetKey = requirements.asset.toLowerCase();
  if (assetKey === LOVELACE_ASSET) {
    // Lovelace: overpayment allowed for min-ada; locked >= amount + collateral.
    if (output.coin < amount + collateral) return fail(ERR_MASUMI_ASSET);
  } else {
    // Native token: exact amount (Masumi forbids token overpayment); its
    // structural lovelace covers collateral (above) and min-UTXO (below).
    if (output.assets[assetKey] !== amount) return fail(ERR_MASUMI_ASSET);
  }
  // The escrow output must carry EXACTLY the requested asset set — no extra
  // native tokens (Masumi rejects a mismatched token count). Zero tokens for a
  // lovelace payment; exactly the one requested token otherwise.
  if (Object.keys(output.assets).length !== (assetKey === LOVELACE_ASSET ? 0 : 1)) {
    return fail(ERR_MASUMI_ASSET);
  }

  // 6. min-UTXO with post-result headroom (when the live coinsPerUtxoByte is
  //    available): the escrow output must hold enough lovelace that the seller's
  //    later SubmitResult output (32-byte result_hash + non-zero cooldowns) still
  //    clears the protocol min-UTXO. Otherwise the seller can never spend.
  if (coinsPerUtxoByte !== undefined) {
    const nativeTokenCount = Object.keys(output.assets).length;
    const requiredMinUtxo = masumiMinUtxoLovelace(
      datumHex.length / 2,
      nativeTokenCount,
      coinsPerUtxoByte,
    );
    if (output.coin < requiredMinUtxo) return fail(ERR_MASUMI_MIN_UTXO);
  }

  // 7. Field matching against the canonical requirements' extra.
  //    buyer MUST be the payer; seller MUST be the declared seller.
  if (!sameCredentials(view.buyer, addressCredentials(payer))) {
    return fail(ERR_MASUMI_DATUM_MISMATCH);
  }
  if (!sameCredentials(view.seller, addressCredentials(extra.sellerAddress))) {
    return fail(ERR_MASUMI_DATUM_MISMATCH);
  }
  // Return addresses must match EXACTLY: declared in extra -> datum `Some(match)`,
  // omitted -> datum `None`. Masumi compares these against the purchase, so a
  // return address it doesn't expect (or a missing one it does) is rejected.
  if (
    !returnAddressMatches(extra.buyerReturnAddress, view.buyerReturnAddress) ||
    !returnAddressMatches(extra.sellerReturnAddress, view.sellerReturnAddress)
  ) {
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
