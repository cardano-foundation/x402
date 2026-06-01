// Package server provides the Cardano `exact` server-side scheme.
//
// Resource servers register an instance of ExactCardanoScheme with an
// x402.X402ResourceServer for one or more Cardano networks; the framework
// then takes care of issuing 402 challenges, decoding the
// PAYMENT-SIGNATURE header, dispatching to a remote facilitator's
// /verify and /settle endpoints, and emitting the PAYMENT-RESPONSE header.
//
// The scheme implements x402.SchemeNetworkServer (V2) — no chain-side
// logic lives here; CBOR decoding and rule enforcement happen in a remote
// facilitator (Python reference implementation, or any V2-compatible
// facilitator).
package server

import (
	"context"
	"errors"
	"fmt"
	"strings"

	x402 "github.com/x402-foundation/x402/go/v2"
	"github.com/x402-foundation/x402/go/v2/mechanisms/cardano"
	"github.com/x402-foundation/x402/go/v2/types"
)

// ExactCardanoScheme implements x402.SchemeNetworkServer for the Cardano
// `exact` payment scheme.
//
// Use NewExactCardanoScheme() to construct it; register it with the resource
// server like:
//
//	server.Register(cardano.CardanoPreprod, cscheme.NewExactCardanoScheme())
type ExactCardanoScheme struct {
	moneyParsers []x402.MoneyParser
}

// NewExactCardanoScheme constructs an ExactCardanoScheme with the default
// (USDM-based) Money parser as the final fallback.
func NewExactCardanoScheme() *ExactCardanoScheme {
	return &ExactCardanoScheme{}
}

// Scheme returns the scheme identifier ("exact"). Required by
// x402.SchemeNetworkServer.
func (s *ExactCardanoScheme) Scheme() string { return cardano.SchemeExact }

// RegisterMoneyParser appends a custom money parser to the chain. Parsers
// are tried in registration order; the first non-nil result wins. The
// default USDM-based conversion is always the final fallback.
//
// Example:
//
//	scheme.RegisterMoneyParser(func(amount float64, n x402.Network) (*x402.AssetAmount, error) {
//	    if amount > 100 { return &x402.AssetAmount{Amount: ..., Asset: "lovelace"}, nil }
//	    return nil, nil // defer to next parser
//	})
func (s *ExactCardanoScheme) RegisterMoneyParser(parser x402.MoneyParser) *ExactCardanoScheme {
	s.moneyParsers = append(s.moneyParsers, parser)
	return s
}

// ParsePrice converts a Price (Money string/number or {amount,asset} map)
// into an AssetAmount. Required by x402.SchemeNetworkServer.
func (s *ExactCardanoScheme) ParsePrice(price x402.Price, network x402.Network) (x402.AssetAmount, error) {
	netStr := string(network)
	if !cardano.IsCardanoNetwork(netStr) {
		return x402.AssetAmount{}, &cardano.UnsupportedNetworkError{Network: netStr}
	}

	// Pre-parsed AssetAmount style: {amount, asset, [extra]}.
	if priceMap, ok := price.(map[string]interface{}); ok {
		if amountVal, hasAmount := priceMap["amount"]; hasAmount {
			amount, ok := amountVal.(string)
			if !ok {
				return x402.AssetAmount{}, errors.New("amount must be a string")
			}
			asset, _ := priceMap["asset"].(string)
			if asset == "" {
				return x402.AssetAmount{}, fmt.Errorf(
					"asset unit must be specified for AssetAmount on network %s", netStr)
			}
			if err := cardano.ValidateAssetUnit(asset); err != nil {
				return x402.AssetAmount{}, err
			}
			extra, _ := priceMap["extra"].(map[string]interface{})
			if extra == nil {
				extra = map[string]interface{}{}
			}
			return x402.AssetAmount{Amount: amount, Asset: asset, Extra: extra}, nil
		}
	}

	// Money parsing → custom parsers → default conversion.
	decimalStr, err := cardano.ParseMoneyToDecimal(price)
	if err != nil {
		return x402.AssetAmount{}, err
	}
	// Try numeric form for custom parsers; ignore parse failures (the
	// default path uses the decimal string anyway).
	for _, parser := range s.moneyParsers {
		decimal, parseErr := strconvFloat(decimalStr)
		if parseErr != nil {
			continue
		}
		result, perr := parser(decimal, network)
		if perr != nil {
			continue
		}
		if result != nil {
			if result.Asset == "" {
				return x402.AssetAmount{}, errors.New("money parser returned empty asset")
			}
			if err := cardano.ValidateAssetUnit(result.Asset); err != nil {
				return x402.AssetAmount{}, fmt.Errorf("money parser returned invalid asset: %w", err)
			}
			return *result, nil
		}
	}

	return s.defaultMoneyConversion(decimalStr, netStr)
}

// EnhancePaymentRequirements is the hook the framework calls after
// ParsePrice to merge facilitator-supplied extras into the requirements.
// Required by x402.SchemeNetworkServer.
func (s *ExactCardanoScheme) EnhancePaymentRequirements(
	ctx context.Context,
	requirements types.PaymentRequirements,
	supportedKind types.SupportedKind,
	extensionKeys []string,
) (types.PaymentRequirements, error) {
	_ = ctx
	netStr := string(requirements.Network)
	if !cardano.IsCardanoNetwork(netStr) {
		return requirements, &cardano.UnsupportedNetworkError{Network: netStr}
	}
	if requirements.Extra == nil {
		requirements.Extra = map[string]interface{}{}
	}
	// Default assetTransferMethod to "default" if missing.
	if _, ok := requirements.Extra["assetTransferMethod"]; !ok {
		requirements.Extra["assetTransferMethod"] = cardano.AssetTransferMethodDefault
	}
	// Merge supported_kind extras (server-side requirements always win).
	for k, v := range supportedKind.Extra {
		if _, exists := requirements.Extra[k]; !exists {
			requirements.Extra[k] = v
		}
	}
	// Carry through requested extension keys.
	for _, key := range extensionKeys {
		if val, ok := supportedKind.Extra[key]; ok {
			requirements.Extra[key] = val
		}
	}
	return requirements, nil
}

// GetAssetDecimals reports decimal precision for the asset. Cardano native
// ADA always has 6 decimals (lovelace), and most stablecoins use 6 too.
// Override by subclassing or wrapping if you have a custom-decimal token.
// Implements x402.AssetDecimalsProvider.
func (s *ExactCardanoScheme) GetAssetDecimals(asset string, network x402.Network) int {
	_ = asset
	_ = network
	return cardano.USDMDefaultDecimals
}

// defaultMoneyConversion converts a decimal string (e.g. "1.50") into
// the network's default asset's smallest unit.
func (s *ExactCardanoScheme) defaultMoneyConversion(decimalStr, network string) (x402.AssetAmount, error) {
	cfg, err := cardano.GetNetworkConfig(network)
	if err != nil {
		return x402.AssetAmount{}, err
	}
	if cfg.DefaultAsset == "" {
		return x402.AssetAmount{}, fmt.Errorf(
			"no default asset configured for network %s; supply price as {amount, asset}", network)
	}
	atomic, err := cardano.ConvertToTokenAmount(decimalStr, cardano.USDMDefaultDecimals)
	if err != nil {
		return x402.AssetAmount{}, err
	}
	return x402.AssetAmount{
		Amount: atomic,
		Asset:  cfg.DefaultAsset,
		Extra:  map[string]interface{}{},
	}, nil
}

// strconvFloat is a tiny shim so the file is self-contained and to keep
// the imports tight.
func strconvFloat(s string) (float64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, errors.New("empty string")
	}
	var f float64
	_, err := fmt.Sscanf(s, "%f", &f)
	if err != nil {
		return 0, err
	}
	return f, nil
}
