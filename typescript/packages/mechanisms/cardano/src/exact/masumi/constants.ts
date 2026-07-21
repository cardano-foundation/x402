import { Address, EnterpriseAddress, ScriptHash } from "@evolution-sdk/evolution";

import { getCardanoNetworkId, normalizeCardanoNetwork } from "../../constants";

/**
 * Masumi `PaymentSourceType` targeted by this implementation. `Web3CardanoV2`
 * is the `vested_pay` payment-v2 escrow whose datum this scheme builds.
 */
export const MASUMI_PAYMENT_SOURCE_TYPE = "Web3CardanoV2";

/**
 * Script hash of Masumi's canonical `vested_pay` payment-v2 escrow, with the
 * deployment parameters applied (`required_admins_multi_sig = 2`, the three
 * Masumi admin key hashes, `cooldown_period = 420000`). Network-independent —
 * only the address header differs per network. Derived with Masumi's own
 * `getPaymentScriptV2` (mesh `1.9.0-beta.102`) and cross-checked by reproducing
 * their published V1 address with the same method.
 *
 * This is really just a fallback: the authoritative escrow address comes from
 * the purchase via the required `extra.contractAddress` (which verify() checks
 * against `payTo`). It only backs the {@link masumiContractAddress} helper as a
 * convenience for the canonical deployment, and must not be treated as
 * authoritative — a different (e.g. self-hosted) deployment has a different
 * address, and this hash goes stale if Masumi ever redeploys.
 */
const MASUMI_ESCROW_SCRIPT_HASH = "2d6abca32e4b22b59e948ef22dfe682017de917a9ec088aa1bc3c64e";

/**
 * Default `collateral_return_lovelace` when the requirements omit it (the
 * contract itself defaults this field to 0). All other datum identifiers and
 * time bounds are required from the requirements — they are purchase-bound and
 * must not be defaulted or randomized.
 */
export const MASUMI_DEFAULT_COLLATERAL_LOVELACE = 0n;

/**
 * Non-zero `collateral_return_lovelace` floor enforced by Masumi's off-chain
 * validation (`checkPaymentAmountsMatch`, `CONSTANTS.MIN_COLLATERAL_LOVELACE`).
 * A positive collateral below this is rejected.
 */
export const MASUMI_MIN_COLLATERAL_LOVELACE = 1_435_230n;

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
 * Lovelace a native-token lock must put on the escrow output. The requested
 * amount is the token, so this lovelace is purely structural: it has to clear
 * the post-result min-UTXO and still cover the collateral the seller reclaims,
 * hence the larger of the two.
 *
 * @param lockDatumBytes - Byte length of the current (empty-result) lock datum.
 * @param collateralLovelace - The datum's `collateral_return_lovelace`.
 * @param coinsPerUtxoByte - Live `coinsPerUtxoByte` protocol parameter.
 * @returns The lovelace to attach to the escrow output.
 */
export function masumiTokenLockLovelace(
  lockDatumBytes: number,
  collateralLovelace: bigint,
  coinsPerUtxoByte: bigint,
): bigint {
  const floor = masumiMinUtxoLovelace(lockDatumBytes, 1, coinsPerUtxoByte);
  return floor > collateralLovelace ? floor : collateralLovelace;
}

/**
 * Resolves the address of Masumi's canonical `vested_pay` escrow for a network.
 * Fallback convenience only — the authoritative escrow address comes from the
 * purchase via `extra.contractAddress`; a server on a different deployment
 * supplies its own and must not rely on this.
 *
 * @param network - The x402 Cardano network identifier (or a CIP-34 alias).
 * @returns The bech32 enterprise script address of Masumi's canonical escrow.
 */
export function masumiContractAddress(network: string): string {
  const enterprise = new EnterpriseAddress.EnterpriseAddress({
    networkId: getCardanoNetworkId(normalizeCardanoNetwork(network)),
    paymentCredential: ScriptHash.fromHex(MASUMI_ESCROW_SCRIPT_HASH),
  });
  return Address.toBech32(enterprise as unknown as Address.Address);
}
