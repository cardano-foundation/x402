"""Cardano mechanism constants - network configs, USDM defaults, error codes."""

from typing import TypedDict

# Scheme identifier (matches other mechanisms).
SCHEME_EXACT = "exact"

# x402 network identifiers for Cardano (per spec — *not* canonical CAIP-2).
CARDANO_MAINNET_CAIP2 = "cardano:mainnet"
CARDANO_PREPROD_CAIP2 = "cardano:preprod"
CARDANO_PREVIEW_CAIP2 = "cardano:preview"

CARDANO_NETWORKS: list[str] = [
    CARDANO_MAINNET_CAIP2,
    CARDANO_PREPROD_CAIP2,
    CARDANO_PREVIEW_CAIP2,
]

# Cardano network IDs encoded in the transaction body. Mainnet=1, every testnet=0.
CARDANO_NETWORK_ID_MAINNET = 1
CARDANO_NETWORK_ID_TESTNET = 0

# Default USDM token defaults (per the spec example).
USDM_MAINNET_POLICY_ID = "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad"
USDM_PREPROD_POLICY_ID = "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde"
USDM_ASSET_NAME_HEX = "0014df105553444d"  # CIP-68 (333) prefix + 'USDM'
USDM_MAINNET_ASSET = f"{USDM_MAINNET_POLICY_ID}.{USDM_ASSET_NAME_HEX}"
USDM_PREPROD_ASSET = f"{USDM_PREPROD_POLICY_ID}.{USDM_ASSET_NAME_HEX}"
USDM_DEFAULT_DECIMALS = 6

# Asset identifier for native ADA. The Cardano facilitator special-cases this
# value: lovelace lives in an output's `coin` field, not in its multi-asset
# map, so the verifier compares against `output.coin` when the asset string
# is exactly `"lovelace"`.
LOVELACE_ASSET = "lovelace"

# Validation regexes. The asset regex accepts either the literal "lovelace"
# (native ADA) or `policyId.assetNameHex` for native tokens.
CARDANO_ASSET_REGEX = r"^(lovelace|[0-9a-fA-F]{56}\.[0-9a-fA-F]{0,64})$"
CARDANO_ADDRESS_REGEX = r"^(addr1|addr_test1)[0-9a-z]+$"
CARDANO_UTXO_REF_REGEX = r"^[0-9a-fA-F]{64}#\d+$"

# Asset transfer method markers.
ASSET_TRANSFER_METHOD_DEFAULT = "default"
ASSET_TRANSFER_METHOD_MASUMI = "masumi"
ASSET_TRANSFER_METHOD_SCRIPT = "script"

# Error codes — mirror SVM/Aptos style for log filtering.
ERR_UNSUPPORTED_SCHEME = "unsupported_scheme"
ERR_INVALID_PAYLOAD = "invalid_exact_cardano_payload"
ERR_NETWORK_MISMATCH = "network_mismatch"
ERR_TRANSACTION_DECODE_FAILED = "invalid_exact_cardano_payload_transaction_decode_failed"
ERR_NETWORK_ID_MISMATCH = "invalid_exact_cardano_payload_network_id_mismatch"
ERR_RECIPIENT_MISMATCH = "invalid_exact_cardano_payload_recipient_mismatch"
ERR_ASSET_MISMATCH = "invalid_exact_cardano_payload_asset_mismatch"
ERR_AMOUNT_INSUFFICIENT = "invalid_exact_cardano_payload_amount_insufficient"
ERR_NONCE_INVALID = "invalid_exact_cardano_payload_nonce_invalid"
ERR_NONCE_NOT_IN_INPUTS = "invalid_exact_cardano_payload_nonce_not_in_inputs"
ERR_NONCE_NOT_ON_CHAIN = "invalid_exact_cardano_payload_nonce_not_on_chain"
ERR_TTL_EXPIRED = "invalid_exact_cardano_payload_ttl_expired"
ERR_VALIDITY_NOT_YET_VALID = "invalid_exact_cardano_payload_not_yet_valid"
ERR_CHAIN_LOOKUP_FAILED = "exact_cardano_facilitator_chain_lookup_failed"
ERR_SETTLEMENT_FAILED = "exact_cardano_settlement_failed"
ERR_SETTLEMENT_NOT_CONFIRMED = "exact_cardano_settlement_not_confirmed"
ERR_DUPLICATE_SETTLEMENT = "duplicate_settlement"
ERR_SCRIPT_ADDRESS_MISMATCH = "invalid_exact_cardano_payload_script_address_mismatch"
ERR_CARDANO_SDK_MISSING = "exact_cardano_sdk_missing"
ERR_TRANSACTION_UNSIGNED = "invalid_exact_cardano_payload_unsigned"

# Duplicate-settlement cache lifetime (seconds). 2 minutes covers typical TTLs.
SETTLEMENT_TTL_SECONDS = 120.0


class CardanoNetworkConfig(TypedDict):
    """Network configuration entry for Cardano."""

    network_id: int
    default_asset: str | None


NETWORK_CONFIGS: dict[str, CardanoNetworkConfig] = {
    CARDANO_MAINNET_CAIP2: {
        "network_id": CARDANO_NETWORK_ID_MAINNET,
        "default_asset": USDM_MAINNET_ASSET,
    },
    CARDANO_PREPROD_CAIP2: {
        "network_id": CARDANO_NETWORK_ID_TESTNET,
        "default_asset": USDM_PREPROD_ASSET,
    },
    CARDANO_PREVIEW_CAIP2: {
        "network_id": CARDANO_NETWORK_ID_TESTNET,
        "default_asset": None,
    },
}


def get_cardano_network_id(network: str) -> int:
    """Return the Cardano network id (1 mainnet, 0 testnet) for the supplied
    x402 network identifier.

    Args:
        network: The x402 network identifier (e.g. "cardano:mainnet").

    Returns:
        The Cardano network id.

    Raises:
        ValueError: When the network is not a supported Cardano network.
    """
    config = NETWORK_CONFIGS.get(network)
    if config is None:
        raise ValueError(f"Unsupported Cardano network: {network}")
    return config["network_id"]


def is_cardano_network(network: str) -> bool:
    """Return True when the supplied identifier names a supported Cardano
    network.

    Args:
        network: The network identifier to check.

    Returns:
        True if the network is a supported Cardano network.
    """
    return network in NETWORK_CONFIGS


def get_default_usdm_asset(network: str) -> str:
    """Return the default USDM asset unit for the requested network.

    Args:
        network: The Cardano network identifier.

    Returns:
        The default USDM asset unit string.

    Raises:
        ValueError: When no default USDM is configured (Preview today).
    """
    config = NETWORK_CONFIGS.get(network)
    if config is None or not config["default_asset"]:
        raise ValueError(f"No default USDM asset configured for network: {network}")
    return config["default_asset"]
