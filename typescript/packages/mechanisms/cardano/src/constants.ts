/**
 * Network identifier for Cardano Mainnet.
 *
 * The x402 Cardano spec uses human-readable names ("cardano:mainnet") rather
 * than canonical CAIP-2 form ("cardano:1" or genesis-hash CAIP-2). Treat these
 * as x402-local network identifiers; do not "fix" them to canonical CAIP-2.
 */
export const CARDANO_MAINNET_CAIP2 = "cardano:mainnet";

/**
 * Network identifier for Cardano Preprod (testnet).
 */
export const CARDANO_PREPROD_CAIP2 = "cardano:preprod";

/**
 * Network identifier for Cardano Preview (testnet).
 */
export const CARDANO_PREVIEW_CAIP2 = "cardano:preview";

/**
 * All Cardano networks supported by this implementation.
 */
export const CARDANO_NETWORKS = [
  CARDANO_MAINNET_CAIP2,
  CARDANO_PREPROD_CAIP2,
  CARDANO_PREVIEW_CAIP2,
] as const;

/**
 * Cardano network ID encoded inside transaction bodies.
 * Mainnet = 1, every testnet = 0.
 */
export const CARDANO_NETWORK_ID_MAINNET = 1;
/**
 * Cardano network ID encoded inside transaction bodies for testnets.
 */
export const CARDANO_NETWORK_ID_TESTNET = 0;

/**
 * The Exact scheme identifier (matches other mechanisms).
 */
export const SCHEME_EXACT = "exact";

/**
 * USDM policy id on Cardano Mainnet.
 */
export const USDM_MAINNET_POLICY_ID = "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad";

/**
 * USDM policy id on Cardano Preprod.
 */
export const USDM_PREPROD_POLICY_ID = "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde";

/**
 * USDM (333) reference asset name (hex of "(333) USDM").
 *
 * The CIP-68 reference token uses the (333) prefix `0014df10` followed by the
 * hex-encoded UTF-8 of `USDM` (0x5553444d).
 */
export const USDM_ASSET_NAME_HEX = "0014df105553444d";

/**
 * Default USDM unit on Mainnet (`policyId.assetNameHex`).
 */
export const USDM_MAINNET_ASSET = `${USDM_MAINNET_POLICY_ID}.${USDM_ASSET_NAME_HEX}`;

/**
 * Default USDM unit on Preprod (`policyId.assetNameHex`).
 */
export const USDM_PREPROD_ASSET = `${USDM_PREPROD_POLICY_ID}.${USDM_ASSET_NAME_HEX}`;

/**
 * Default decimals for USDM (matches USDC).
 */
export const USDM_DEFAULT_DECIMALS = 6;

/**
 * Asset identifier for native ADA. The Cardano facilitator special-cases
 * this value: lovelace lives in an output's `coin` field, not in its
 * multi-asset map, so the verifier compares against `output.coin` when the
 * asset string is exactly `"lovelace"`.
 */
export const LOVELACE_ASSET = "lovelace";

/**
 * Cardano asset unit regex.
 *
 * Accepts either the literal `"lovelace"` (native ADA) or a
 * `policyId.assetNameHex` pair, where:
 * - policyId: 28 bytes -> 56 hex characters.
 * - assetName: 0..32 bytes -> 0..64 hex characters.
 */
export const CARDANO_ASSET_REGEX = /^(lovelace|[0-9a-fA-F]{56}\.[0-9a-fA-F]{0,64})$/;

/**
 * Cardano payment address regex (very permissive).
 * - Mainnet bech32: `addr1...`
 * - Testnet bech32: `addr_test1...`
 */
export const CARDANO_ADDRESS_REGEX = /^(addr1|addr_test1)[0-9a-z]+$/;

/**
 * UTXO reference regex: `${txHashHex}#${index}`.
 * - txHash: 32 bytes -> 64 hex characters.
 * - index: non-negative integer.
 */
export const CARDANO_UTXO_REF_REGEX = /^[0-9a-fA-F]{64}#\d+$/;

/**
 * Maximum allowed value for assetTransferMethod.
 */
export const ASSET_TRANSFER_METHOD_DEFAULT = "default";
/**
 * Marker for the Masumi smart-contract assetTransferMethod.
 */
export const ASSET_TRANSFER_METHOD_MASUMI = "masumi";
/**
 * Marker for the script assetTransferMethod.
 */
export const ASSET_TRANSFER_METHOD_SCRIPT = "script";

/**
 * Resolves the Cardano network ID embedded in the transaction body for a given
 * x402 network identifier.
 *
 * @param network - The x402 network identifier (e.g. "cardano:mainnet").
 * @returns The Cardano network ID (1 = mainnet, 0 = testnet).
 */
export function getCardanoNetworkId(network: string): number {
  switch (network) {
    case CARDANO_MAINNET_CAIP2:
      return CARDANO_NETWORK_ID_MAINNET;
    case CARDANO_PREPROD_CAIP2:
    case CARDANO_PREVIEW_CAIP2:
      return CARDANO_NETWORK_ID_TESTNET;
    default:
      throw new Error(`Unsupported Cardano network: ${network}`);
  }
}

/**
 * Returns true when the supplied network identifier is one of the Cardano
 * networks supported by this mechanism.
 *
 * @param network - The network identifier to validate.
 * @returns True if the network is a supported Cardano network.
 */
export function isCardanoNetwork(network: string): boolean {
  return (CARDANO_NETWORKS as readonly string[]).includes(network);
}

/**
 * Returns the default USDM asset unit for the requested network.
 *
 * Preview is intentionally not covered by an officially deployed USDM token at
 * the time of writing; callers must supply a custom asset for Preview
 * deployments.
 *
 * @param network - The Cardano network identifier.
 * @returns The default USDM asset unit string.
 */
export function getDefaultUsdmAsset(network: string): string {
  switch (network) {
    case CARDANO_MAINNET_CAIP2:
      return USDM_MAINNET_ASSET;
    case CARDANO_PREPROD_CAIP2:
      return USDM_PREPROD_ASSET;
    default:
      throw new Error(`No default USDM asset configured for network: ${network}`);
  }
}

/**
 * Error codes produced by the Cardano facilitator. Mirrors SVM/Aptos style for
 * easy log filtering.
 */
export const ERR_UNSUPPORTED_SCHEME = "unsupported_scheme";
/** Error: payload is missing required fields. */
export const ERR_INVALID_PAYLOAD = "invalid_exact_cardano_payload";
/** Error: declared and accepted networks differ. */
export const ERR_NETWORK_MISMATCH = "network_mismatch";
/** Error: signed transaction could not be CBOR decoded. */
export const ERR_TRANSACTION_DECODE_FAILED =
  "invalid_exact_cardano_payload_transaction_decode_failed";
/** Error: transaction targets a different Cardano network than required. */
export const ERR_NETWORK_ID_MISMATCH = "invalid_exact_cardano_payload_network_id_mismatch";
/** Error: transaction has no output going to the requirements.payTo address. */
export const ERR_RECIPIENT_MISMATCH = "invalid_exact_cardano_payload_recipient_mismatch";
/** Error: matching output exists but pays a different asset. */
export const ERR_ASSET_MISMATCH = "invalid_exact_cardano_payload_asset_mismatch";
/** Error: matching output pays the right asset but not enough of it. */
export const ERR_AMOUNT_INSUFFICIENT = "invalid_exact_cardano_payload_amount_insufficient";
/** Error: nonce UTXO reference is missing or malformed. */
export const ERR_NONCE_INVALID = "invalid_exact_cardano_payload_nonce_invalid";
/** Error: nonce UTXO is not present as one of the transaction inputs. */
export const ERR_NONCE_NOT_IN_INPUTS = "invalid_exact_cardano_payload_nonce_not_in_inputs";
/** Error: nonce UTXO no longer exists on chain (already spent or never existed). */
export const ERR_NONCE_NOT_ON_CHAIN = "invalid_exact_cardano_payload_nonce_not_on_chain";
/** Error: transaction TTL has already passed. */
export const ERR_TTL_EXPIRED = "invalid_exact_cardano_payload_ttl_expired";
/** Error: transaction's lower validity bound is in the future. */
export const ERR_VALIDITY_NOT_YET_VALID = "invalid_exact_cardano_payload_not_yet_valid";
/** Error: facilitator could not perform an on-chain lookup needed for verification. */
export const ERR_CHAIN_LOOKUP_FAILED = "exact_cardano_facilitator_chain_lookup_failed";
/** Error: settlement failed when submitting the transaction. */
export const ERR_SETTLEMENT_FAILED = "exact_cardano_settlement_failed";
/** Error: facilitator declined a `mempool`-only settlement and `acceptMempool` is disabled. */
export const ERR_SETTLEMENT_NOT_CONFIRMED = "exact_cardano_settlement_not_confirmed";
/** Error: duplicate settlement detected within the cache window. */
export const ERR_DUPLICATE_SETTLEMENT = "duplicate_settlement";
/** Error: the script assetTransferMethod was selected but reconstruction failed. */
export const ERR_SCRIPT_ADDRESS_MISMATCH = "invalid_exact_cardano_payload_script_address_mismatch";
/** Error: required Cardano SDK is not installed. */
export const ERR_CARDANO_SDK_MISSING = "exact_cardano_sdk_missing";
/** Error: transaction is not signed (no vkey/bootstrap witnesses present). */
export const ERR_TRANSACTION_UNSIGNED = "invalid_exact_cardano_payload_unsigned";
