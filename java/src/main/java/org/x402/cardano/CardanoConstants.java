package org.x402.cardano;

/**
 * Constants for the x402 Cardano `exact` mechanism (V2 protocol).
 *
 * <p>Mirrors the constants defined in the TypeScript and Python reference
 * implementations so error codes, network identifiers, and asset markers are
 * identical across all three SDKs. See
 * {@code python/x402/mechanisms/cardano/constants.py} and
 * {@code typescript/packages/mechanisms/cardano/src/constants.ts} for the
 * canonical definitions.
 *
 * <p>This class is final and not instantiable; access constants statically.
 */
public final class CardanoConstants {

    /** Scheme identifier for the `exact` payment scheme. */
    public static final String SCHEME_EXACT = "exact";

    // ----- Network identifiers (per spec, NOT canonical CAIP-2) ------------

    /** x402 network identifier for Cardano mainnet. */
    public static final String CARDANO_MAINNET = "cardano:mainnet";

    /** x402 network identifier for Cardano preprod testnet. */
    public static final String CARDANO_PREPROD = "cardano:preprod";

    /** x402 network identifier for Cardano preview testnet. */
    public static final String CARDANO_PREVIEW = "cardano:preview";

    // ----- Cardano network IDs encoded in tx body --------------------------

    /** Cardano body network_id for mainnet. */
    public static final int CARDANO_NETWORK_ID_MAINNET = 1;

    /** Cardano body network_id for any testnet (preprod, preview). */
    public static final int CARDANO_NETWORK_ID_TESTNET = 0;

    // ----- Asset constants -------------------------------------------------

    /**
     * Asset identifier for native ADA. The facilitator special-cases this
     * value: lovelace lives in an output's `coin` field rather than in the
     * multi-asset map, so verification compares against {@code output.coin}
     * when the asset string is exactly {@code "lovelace"}.
     */
    public static final String LOVELACE_ASSET = "lovelace";

    /** Default decimals for USDM (and most stablecoins on Cardano). */
    public static final int USDM_DEFAULT_DECIMALS = 6;

    /** USDM policy ID on mainnet. */
    public static final String USDM_MAINNET_POLICY_ID =
            "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad";

    /** USDM policy ID on preprod testnet. */
    public static final String USDM_PREPROD_POLICY_ID =
            "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde";

    /** USDM CIP-68 reference asset name (333 prefix + 'USDM'). */
    public static final String USDM_ASSET_NAME_HEX = "0014df105553444d";

    /** Mainnet USDM asset unit ({@code policyId.assetNameHex}). */
    public static final String USDM_MAINNET_ASSET =
            USDM_MAINNET_POLICY_ID + "." + USDM_ASSET_NAME_HEX;

    /** Preprod USDM asset unit ({@code policyId.assetNameHex}). */
    public static final String USDM_PREPROD_ASSET =
            USDM_PREPROD_POLICY_ID + "." + USDM_ASSET_NAME_HEX;

    // ----- Validation regexes ---------------------------------------------

    /**
     * Asset unit validation regex. Accepts the literal {@code "lovelace"}
     * (native ADA) or {@code policyId.assetNameHex} for native tokens.
     */
    public static final String CARDANO_ASSET_REGEX =
            "^(lovelace|[0-9a-fA-F]{56}\\.[0-9a-fA-F]{0,64})$";

    /** Cardano bech32 address validation (mainnet or testnet). */
    public static final String CARDANO_ADDRESS_REGEX = "^(addr1|addr_test1)[0-9a-z]+$";

    /** UTXO reference validation regex ({@code txHashHex#index}). */
    public static final String CARDANO_UTXO_REF_REGEX = "^[0-9a-fA-F]{64}#\\d+$";

    // ----- assetTransferMethod markers ------------------------------------

    /** Default asset-transfer method (sender pays + signs). */
    public static final String ASSET_TRANSFER_METHOD_DEFAULT = "default";

    /** Masumi smart-protocol asset-transfer method. */
    public static final String ASSET_TRANSFER_METHOD_MASUMI = "masumi";

    /** Plutus-script asset-transfer method. */
    public static final String ASSET_TRANSFER_METHOD_SCRIPT = "script";

    // ----- Error codes (mirrored from spec; identical across SDKs) ---------

    /** Returned when the scheme is not "exact". */
    public static final String ERR_UNSUPPORTED_SCHEME = "unsupported_scheme";

    /** Generic invalid Cardano payload (decode error, missing fields, etc.). */
    public static final String ERR_INVALID_PAYLOAD = "invalid_exact_cardano_payload";

    /** Transaction CBOR could not be decoded. */
    public static final String ERR_TRANSACTION_DECODE_FAILED =
            "invalid_exact_cardano_payload_transaction_decode_failed";

    /** Transaction body declares a network_id that disagrees with the network. */
    public static final String ERR_NETWORK_ID_MISMATCH =
            "invalid_exact_cardano_payload_network_id_mismatch";

    /** Transaction's accepted.network differs from required network. */
    public static final String ERR_NETWORK_MISMATCH = "network_mismatch";

    /** No transaction output pays the required recipient. */
    public static final String ERR_RECIPIENT_MISMATCH =
            "invalid_exact_cardano_payload_recipient_mismatch";

    /** Recipient output exists but does not carry the required asset. */
    public static final String ERR_ASSET_MISMATCH =
            "invalid_exact_cardano_payload_asset_mismatch";

    /** Recipient + asset matched, but the amount is below the requirement. */
    public static final String ERR_AMOUNT_INSUFFICIENT =
            "invalid_exact_cardano_payload_amount_insufficient";

    /** Nonce is not a valid UTXO reference (txHashHex#index). */
    public static final String ERR_NONCE_INVALID =
            "invalid_exact_cardano_payload_nonce_invalid";

    /** Nonce UTXO reference is not present among the transaction inputs. */
    public static final String ERR_NONCE_NOT_IN_INPUTS =
            "invalid_exact_cardano_payload_nonce_not_in_inputs";

    /** Nonce UTXO is unknown or already spent on chain. */
    public static final String ERR_NONCE_NOT_ON_CHAIN =
            "invalid_exact_cardano_payload_nonce_not_on_chain";

    /** Transaction's TTL slot is in the past. */
    public static final String ERR_TTL_EXPIRED = "invalid_exact_cardano_payload_ttl_expired";

    /** Transaction's validity start slot is still in the future. */
    public static final String ERR_VALIDITY_NOT_YET_VALID =
            "invalid_exact_cardano_payload_not_yet_valid";

    /** Facilitator failed to query Blockfrost / the chain. */
    public static final String ERR_CHAIN_LOOKUP_FAILED =
            "exact_cardano_facilitator_chain_lookup_failed";

    /** Submission to chain failed. */
    public static final String ERR_SETTLEMENT_FAILED = "exact_cardano_settlement_failed";

    /** Submission accepted but the chain has not yet confirmed. */
    public static final String ERR_SETTLEMENT_NOT_CONFIRMED =
            "exact_cardano_settlement_not_confirmed";

    /** Repeated settlement attempt with the same transaction. */
    public static final String ERR_DUPLICATE_SETTLEMENT = "duplicate_settlement";

    /** Reconstructed script address disagrees with declared payTo. */
    public static final String ERR_SCRIPT_ADDRESS_MISMATCH =
            "invalid_exact_cardano_payload_script_address_mismatch";

    /** Optional Cardano SDK (pycardano / serialization-lib) is missing. */
    public static final String ERR_CARDANO_SDK_MISSING = "exact_cardano_sdk_missing";

    /** Transaction has zero witnesses (vkey + script). */
    public static final String ERR_TRANSACTION_UNSIGNED =
            "invalid_exact_cardano_payload_unsigned";

    /** Default {@code maxTimeoutSeconds} for Cardano payment requirements. */
    public static final int DEFAULT_MAX_TIMEOUT_SECONDS = 300;

    private CardanoConstants() {}

    /**
     * Return the Cardano network_id for a given x402 network identifier.
     *
     * @param network x402 network identifier (e.g. {@code "cardano:preprod"})
     * @return 1 for mainnet, 0 for testnets
     * @throws IllegalArgumentException when the network is not a Cardano network
     */
    public static int getNetworkId(String network) {
        if (CARDANO_MAINNET.equals(network)) {
            return CARDANO_NETWORK_ID_MAINNET;
        }
        if (CARDANO_PREPROD.equals(network) || CARDANO_PREVIEW.equals(network)) {
            return CARDANO_NETWORK_ID_TESTNET;
        }
        throw new IllegalArgumentException("Unsupported Cardano network: " + network);
    }

    /**
     * Return whether the supplied identifier names a supported Cardano network.
     *
     * @param network identifier to check (may be null)
     * @return true if the network is mainnet, preprod, or preview
     */
    public static boolean isCardanoNetwork(String network) {
        return CARDANO_MAINNET.equals(network)
                || CARDANO_PREPROD.equals(network)
                || CARDANO_PREVIEW.equals(network);
    }
}
