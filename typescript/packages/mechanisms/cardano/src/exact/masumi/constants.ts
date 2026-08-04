/**
 * Masumi `PaymentSourceType` targeted by this implementation. `Web3CardanoV2`
 * is the `vested_pay` payment-v2 escrow whose datum this scheme builds. Any
 * other value MUST be rejected: the field selects the contract generation and
 * is not advisory.
 */
export const MASUMI_PAYMENT_SOURCE_TYPE = "Web3CardanoV2";

/**
 * Global Masumi V2 registry policy id. A non-empty `terms.agentIdentifier`
 * makes a registry claim and MUST start with this policy — another policy is
 * not a Masumi V2 registry.
 */
export const MASUMI_REGISTRY_POLICY_ID = "67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b";

/**
 * Non-zero `collateral_return_lovelace` floor. The client computes the
 * collateral itself, but a positive value below this floor is rejected by
 * Masumi's off-chain validation (`CONSTANTS.MIN_COLLATERAL_LOVELACE`).
 */
export const MASUMI_MIN_COLLATERAL_LOVELACE = 1_435_230n;

/** Minimum gap from `pay_by_time` to `submit_result_time`. */
export const MASUMI_MIN_PAY_TO_SUBMIT_MS = 5n * 60n * 1000n;

/** Minimum gap from `submit_result_time` to `unlock_time`. */
export const MASUMI_MIN_SUBMIT_TO_UNLOCK_MS = 15n * 60n * 1000n;

/** Minimum gap from `unlock_time` to `external_dispute_unlock_time`. */
export const MASUMI_MIN_UNLOCK_TO_DISPUTE_MS = 15n * 60n * 1000n;

// Min-UTXO for the escrow output must cover the datum as it will look AFTER the
// seller submits a result, not at lock time: `result_hash` grows from empty to
// 32 bytes and the cooldowns from 0 to real POSIX-ms timestamps. Otherwise the
// seller's SubmitResult output falls below min-UTXO and cannot be built. These
// mirror Masumi's `calculateMinUtxo` (utils/min-utxo) so a lock this facilitator
// accepts also clears their off-chain check.
/** CBOR byte delta of an empty vs 32-byte `result_hash` bytestring (0x40 -> 0x5820…). */
const MASUMI_RESULT_HASH_DELTA_BYTES = 33;
/** Constant overhead (input + UTXO-map entry), same as the ledger's `160`. */
const MASUMI_MINUTXO_OVERHEAD_BYTES = 160;
/** Headroom buffer for the submitted result hash. */
const MASUMI_MINUTXO_RESULT_HASH_BUFFER = 50;
/** Headroom buffer for the two cooldown timestamps becoming non-zero. */
const MASUMI_MINUTXO_COOLDOWN_BUFFER = 15;
/** Safety margin keeping the estimate above the ledger floor. */
const MASUMI_MINUTXO_SAFETY_MARGIN = 100;
/** Per-native-token headroom buffer. */
const MASUMI_MINUTXO_PER_TOKEN_BUFFER = 50;

/**
 * Minimum lovelace the escrow output must carry, computed on the datum as it
 * will look after `SubmitResult` (32-byte `result_hash` + buffers), mirroring
 * Masumi's `calculateMinUtxo`.
 *
 * @param lockDatumBytes - Byte length of the current (empty-result) lock datum.
 * @param nativeTokenCount - Distinct native tokens carried by the escrow output.
 * @param coinsPerUtxoByte - Live `coinsPerUtxoByte` protocol parameter.
 * @returns The minimum lovelace the escrow output must hold.
 */
export function masumiMinUtxoLovelace(
  lockDatumBytes: number,
  nativeTokenCount: number,
  coinsPerUtxoByte: bigint,
): bigint {
  const totalBytes =
    lockDatumBytes +
    MASUMI_RESULT_HASH_DELTA_BYTES +
    MASUMI_MINUTXO_OVERHEAD_BYTES +
    MASUMI_MINUTXO_RESULT_HASH_BUFFER +
    MASUMI_MINUTXO_COOLDOWN_BUFFER +
    MASUMI_MINUTXO_SAFETY_MARGIN +
    MASUMI_MINUTXO_PER_TOKEN_BUFFER * nativeTokenCount;
  return coinsPerUtxoByte * BigInt(totalBytes);
}

/**
 * The `collateral_return_lovelace` a lock must carry.
 *
 * The seller never supplies or signs this value: the client computes it from
 * the requested asset and live protocol parameters, and the escrow output must
 * satisfy `lockedLovelace = requestedLovelace + collateral_return_lovelace`.
 *
 * A **lovelace** payment can therefore run with zero collateral when the
 * requested amount already clears the post-`SubmitResult` min-UTXO. A
 * **native-token** payment has `requestedLovelace = 0`, so zero collateral
 * cannot satisfy both rules and the collateral must be at least the larger of
 * the floor and that min-UTXO.
 *
 * @param requestedLovelace - `amount` for a lovelace payment, `0` for a token.
 * @param lockDatumBytes - Byte length of the current (empty-result) lock datum.
 * @param nativeTokenCount - Distinct native tokens carried by the escrow output.
 * @param coinsPerUtxoByte - Live `coinsPerUtxoByte` protocol parameter.
 * @returns The collateral to place in the datum.
 */
export function masumiCollateralLovelace(
  requestedLovelace: bigint,
  lockDatumBytes: number,
  nativeTokenCount: number,
  coinsPerUtxoByte: bigint,
): bigint {
  const minUtxo = masumiMinUtxoLovelace(lockDatumBytes, nativeTokenCount, coinsPerUtxoByte);
  if (requestedLovelace >= minUtxo) return 0n;
  const shortfall = minUtxo - requestedLovelace;
  return shortfall > MASUMI_MIN_COLLATERAL_LOVELACE ? shortfall : MASUMI_MIN_COLLATERAL_LOVELACE;
}
