// Package cardano provides x402 Cardano `exact` mechanism constants and types.
//
// The package mirrors the canonical TypeScript and Python implementations under
// typescript/packages/mechanisms/cardano and python/x402/mechanisms/cardano so
// error codes, network identifiers, and asset markers are byte-for-byte
// identical across all SDKs.
//
// The Go SDK is server-side only — it never decodes Cardano CBOR. All chain
// inspection happens in a remote facilitator. Use the
// `mechanisms/cardano/exact/server` subpackage to register the Cardano scheme
// with an x402.X402ResourceServer.
package cardano

import "time"

const (
	// SchemeExact is the scheme identifier for the `exact` payment scheme.
	SchemeExact = "exact"

	// CAIP-2-ish network identifiers (per spec — NOT canonical CAIP-2).

	// CardanoMainnet is the x402 network identifier for Cardano mainnet.
	CardanoMainnet = "cardano:mainnet"
	// CardanoPreprod is the x402 network identifier for Cardano preprod testnet.
	CardanoPreprod = "cardano:preprod"
	// CardanoPreview is the x402 network identifier for Cardano preview testnet.
	CardanoPreview = "cardano:preview"

	// Cardano network IDs encoded in transaction bodies.

	// NetworkIDMainnet is the Cardano body network_id for mainnet.
	NetworkIDMainnet = 1
	// NetworkIDTestnet is the Cardano body network_id for any testnet.
	NetworkIDTestnet = 0

	// LovelaceAsset is the asset marker for native ADA. The facilitator
	// special-cases this value: lovelace lives in an output's `coin` field
	// rather than the multi-asset map, so verification compares against
	// `output.coin` when the asset string is exactly "lovelace".
	LovelaceAsset = "lovelace"

	// USDMDefaultDecimals is the default decimal precision for USDM
	// (and most stablecoins on Cardano).
	USDMDefaultDecimals = 6

	// USDMMainnetPolicyID is the USDM token policy ID on mainnet.
	USDMMainnetPolicyID = "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad"
	// USDMPreprodPolicyID is the USDM token policy ID on preprod.
	USDMPreprodPolicyID = "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde"
	// USDMAssetNameHex is the CIP-68 (333 prefix + "USDM") asset name hex.
	USDMAssetNameHex = "0014df105553444d"

	// USDMMainnetAsset is the full asset unit for USDM on mainnet.
	USDMMainnetAsset = USDMMainnetPolicyID + "." + USDMAssetNameHex
	// USDMPreprodAsset is the full asset unit for USDM on preprod.
	USDMPreprodAsset = USDMPreprodPolicyID + "." + USDMAssetNameHex

	// AssetTransferMethodDefault is the default asset-transfer method
	// (sender pays + signs).
	AssetTransferMethodDefault = "default"
	// AssetTransferMethodMasumi is the Masumi smart-protocol method.
	AssetTransferMethodMasumi = "masumi"
	// AssetTransferMethodScript is the Plutus-script method.
	AssetTransferMethodScript = "script"

	// DefaultMaxTimeoutSeconds is the default `maxTimeoutSeconds` for
	// Cardano payment requirements.
	DefaultMaxTimeoutSeconds = 300

	// SettlementTTL is the duplicate-settlement cache lifetime; matches the
	// Python facilitator's default.
	SettlementTTL = 120 * time.Second

	// Validation regexes.

	// CardanoAssetRegex accepts either the literal "lovelace" (native ADA) or
	// `policyId.assetNameHex` for native tokens.
	CardanoAssetRegex = `^(lovelace|[0-9a-fA-F]{56}\.[0-9a-fA-F]{0,64})$`
	// CardanoAddressRegex accepts both mainnet and testnet bech32 addresses.
	CardanoAddressRegex = `^(addr1|addr_test1)[0-9a-z]+$`
	// CardanoUTXORefRegex validates a UTXO reference (txHashHex#index).
	CardanoUTXORefRegex = `^[0-9a-fA-F]{64}#\d+$`
)

// Error code constants. These mirror the TypeScript / Python / Java SDKs
// byte-for-byte so cross-language error handling is straightforward.
const (
	// ErrUnsupportedScheme — scheme is not "exact".
	ErrUnsupportedScheme = "unsupported_scheme"
	// ErrInvalidPayload — generic invalid Cardano payload (decode error,
	// missing fields, etc.).
	ErrInvalidPayload = "invalid_exact_cardano_payload"
	// ErrTransactionDecodeFailed — transaction CBOR could not be decoded.
	ErrTransactionDecodeFailed = "invalid_exact_cardano_payload_transaction_decode_failed"
	// ErrNetworkIDMismatch — tx body's network_id disagrees with the network.
	ErrNetworkIDMismatch = "invalid_exact_cardano_payload_network_id_mismatch"
	// ErrNetworkMismatch — accepted.network differs from required network.
	ErrNetworkMismatch = "network_mismatch"
	// ErrRecipientMismatch — no transaction output pays the required recipient.
	ErrRecipientMismatch = "invalid_exact_cardano_payload_recipient_mismatch"
	// ErrAssetMismatch — recipient output exists but does not carry the required asset.
	ErrAssetMismatch = "invalid_exact_cardano_payload_asset_mismatch"
	// ErrAmountInsufficient — recipient + asset matched but amount < requirement.
	ErrAmountInsufficient = "invalid_exact_cardano_payload_amount_insufficient"
	// ErrNonceInvalid — nonce is not a valid UTXO reference (txHashHex#index).
	ErrNonceInvalid = "invalid_exact_cardano_payload_nonce_invalid"
	// ErrNonceNotInInputs — nonce UTXO reference is not present among the
	// transaction inputs.
	ErrNonceNotInInputs = "invalid_exact_cardano_payload_nonce_not_in_inputs"
	// ErrNonceNotOnChain — nonce UTXO is unknown or already spent on chain.
	ErrNonceNotOnChain = "invalid_exact_cardano_payload_nonce_not_on_chain"
	// ErrTTLExpired — transaction's TTL slot is in the past.
	ErrTTLExpired = "invalid_exact_cardano_payload_ttl_expired"
	// ErrValidityNotYetValid — transaction's validity start slot is still in the future.
	ErrValidityNotYetValid = "invalid_exact_cardano_payload_not_yet_valid"
	// ErrChainLookupFailed — facilitator failed to query the chain.
	ErrChainLookupFailed = "exact_cardano_facilitator_chain_lookup_failed"
	// ErrSettlementFailed — submission to chain failed.
	ErrSettlementFailed = "exact_cardano_settlement_failed"
	// ErrSettlementNotConfirmed — submission accepted but the chain has not yet confirmed.
	ErrSettlementNotConfirmed = "exact_cardano_settlement_not_confirmed"
	// ErrDuplicateSettlement — repeated settlement attempt with the same transaction.
	ErrDuplicateSettlement = "duplicate_settlement"
	// ErrScriptAddressMismatch — reconstructed script address disagrees with declared payTo.
	ErrScriptAddressMismatch = "invalid_exact_cardano_payload_script_address_mismatch"
	// ErrCardanoSDKMissing — optional Cardano SDK is missing.
	ErrCardanoSDKMissing = "exact_cardano_sdk_missing"
	// ErrTransactionUnsigned — transaction has zero witnesses.
	ErrTransactionUnsigned = "invalid_exact_cardano_payload_unsigned"
)

// NetworkConfig bundles per-network defaults.
type NetworkConfig struct {
	// CAIP2 is the x402 network identifier (e.g. "cardano:preprod").
	CAIP2 string
	// NetworkID is the Cardano body network_id (1 or 0).
	NetworkID int
	// DefaultAsset is the asset unit used when a Money-style price is
	// supplied without an explicit asset (empty for networks without a
	// default — e.g. preview).
	DefaultAsset string
}

// NetworkConfigs maps each x402 Cardano network identifier to its config.
var NetworkConfigs = map[string]NetworkConfig{
	CardanoMainnet: {
		CAIP2:        CardanoMainnet,
		NetworkID:    NetworkIDMainnet,
		DefaultAsset: USDMMainnetAsset,
	},
	CardanoPreprod: {
		CAIP2:        CardanoPreprod,
		NetworkID:    NetworkIDTestnet,
		DefaultAsset: USDMPreprodAsset,
	},
	CardanoPreview: {
		CAIP2:        CardanoPreview,
		NetworkID:    NetworkIDTestnet,
		DefaultAsset: "",
	},
}

// IsCardanoNetwork reports whether the supplied identifier names a supported
// Cardano network.
func IsCardanoNetwork(network string) bool {
	_, ok := NetworkConfigs[network]
	return ok
}

// GetNetworkConfig returns the network configuration for a Cardano network,
// or an error when the network is not supported.
func GetNetworkConfig(network string) (NetworkConfig, error) {
	cfg, ok := NetworkConfigs[network]
	if !ok {
		return NetworkConfig{}, &UnsupportedNetworkError{Network: network}
	}
	return cfg, nil
}

// UnsupportedNetworkError is returned when a network identifier is not a
// recognised Cardano network.
type UnsupportedNetworkError struct {
	Network string
}

func (e *UnsupportedNetworkError) Error() string {
	return "unsupported Cardano network: " + e.Network
}
