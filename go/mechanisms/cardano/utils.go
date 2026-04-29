package cardano

import (
	"fmt"
	"math/big"
	"regexp"
	"strconv"
	"strings"
)

var (
	assetRE  = regexp.MustCompile(CardanoAssetRegex)
	utxoRE   = regexp.MustCompile(CardanoUTXORefRegex)
	addrRE   = regexp.MustCompile(CardanoAddressRegex)
)

// ValidateAssetUnit returns nil when asset is the literal "lovelace" or a
// well-formed `policyId.assetNameHex` pair.
func ValidateAssetUnit(asset string) error {
	if !assetRE.MatchString(asset) {
		return fmt.Errorf("invalid Cardano asset unit: %s", asset)
	}
	return nil
}

// ValidateAddress returns nil when addr is a syntactically valid bech32
// Cardano address (mainnet or testnet). It does not check the bech32
// checksum; that is the facilitator's responsibility.
func ValidateAddress(addr string) error {
	if !addrRE.MatchString(addr) {
		return fmt.Errorf("invalid Cardano address: %s", addr)
	}
	return nil
}

// ValidateUTXORef returns nil when ref looks like `txHashHex#index`.
func ValidateUTXORef(ref string) error {
	if !utxoRE.MatchString(ref) {
		return fmt.Errorf("invalid Cardano UTXO reference: %s", ref)
	}
	return nil
}

// ParseUTXORef splits `txHashHex#index` into its parts.
func ParseUTXORef(ref string) (txHash string, index int, err error) {
	if err = ValidateUTXORef(ref); err != nil {
		return "", 0, err
	}
	idx := strings.IndexByte(ref, '#')
	txHash = strings.ToLower(ref[:idx])
	index, err = strconv.Atoi(ref[idx+1:])
	return
}

// ParseAssetUnit splits an asset unit string. For lovelace both parts are empty.
func ParseAssetUnit(asset string) (policyID, assetNameHex string, err error) {
	if err = ValidateAssetUnit(asset); err != nil {
		return "", "", err
	}
	if strings.EqualFold(asset, LovelaceAsset) {
		return "", "", nil
	}
	dot := strings.IndexByte(asset, '.')
	return strings.ToLower(asset[:dot]), strings.ToLower(asset[dot+1:]), nil
}

// ConvertToTokenAmount converts a decimal-string amount (e.g. "0.10") into
// the asset's smallest atomic unit. Uses arbitrary-precision arithmetic.
func ConvertToTokenAmount(decimalAmount string, decimals int) (string, error) {
	r, ok := new(big.Rat).SetString(strings.TrimSpace(decimalAmount))
	if !ok {
		return "", fmt.Errorf("invalid amount: %s", decimalAmount)
	}
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals)), nil)
	r.Mul(r, new(big.Rat).SetInt(scale))
	if !r.IsInt() {
		return "", fmt.Errorf(
			"amount %s has more decimals than allowed (%d)", decimalAmount, decimals)
	}
	return r.Num().String(), nil
}

// ParseMoneyToDecimal accepts a Money value (string with optional "$"
// prefix and currency suffix, or a numeric type) and returns the decimal
// component as a string.
func ParseMoneyToDecimal(money interface{}) (string, error) {
	switch v := money.(type) {
	case string:
		clean := strings.TrimSpace(v)
		clean = strings.TrimPrefix(clean, "$")
		// Strip a trailing currency code (USD / USDC / USDM, case-insensitive).
		for _, suffix := range []string{" USD", " USDC", " USDM"} {
			if strings.HasSuffix(strings.ToUpper(clean), suffix) {
				clean = strings.TrimSpace(clean[:len(clean)-len(suffix)])
				break
			}
		}
		return strings.TrimSpace(clean), nil
	case int:
		return strconv.Itoa(v), nil
	case int64:
		return strconv.FormatInt(v, 10), nil
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64), nil
	case float32:
		return strconv.FormatFloat(float64(v), 'f', -1, 32), nil
	default:
		return "", fmt.Errorf("invalid money value: %T", money)
	}
}
