package server

import (
	"context"
	"testing"

	x402 "github.com/x402-foundation/x402/go"
	"github.com/x402-foundation/x402/go/mechanisms/cardano"
	"github.com/x402-foundation/x402/go/types"
)

func TestSchemeID(t *testing.T) {
	s := NewExactCardanoScheme()
	if s.Scheme() != "exact" {
		t.Errorf("expected scheme %q, got %q", "exact", s.Scheme())
	}
}

func TestParsePriceWithExplicitAssetAmount(t *testing.T) {
	s := NewExactCardanoScheme()
	asset, err := s.ParsePrice(map[string]interface{}{
		"amount": "5000000",
		"asset":  cardano.LovelaceAsset,
		"extra":  map[string]interface{}{"k": "v"},
	}, x402.Network(cardano.CardanoPreprod))
	if err != nil {
		t.Fatal(err)
	}
	if asset.Amount != "5000000" || asset.Asset != cardano.LovelaceAsset {
		t.Errorf("unexpected asset amount: %+v", asset)
	}
	if asset.Extra["k"] != "v" {
		t.Errorf("extra not propagated: %+v", asset.Extra)
	}
}

func TestParsePriceRejectsBadAsset(t *testing.T) {
	s := NewExactCardanoScheme()
	_, err := s.ParsePrice(map[string]interface{}{
		"amount": "5000000",
		"asset":  "0xinvalid",
	}, x402.Network(cardano.CardanoPreprod))
	if err == nil {
		t.Fatal("expected validation error for non-Cardano asset format")
	}
}

func TestParsePriceMoneyDefaultsToUSDM(t *testing.T) {
	s := NewExactCardanoScheme()
	asset, err := s.ParsePrice("1.50", x402.Network(cardano.CardanoPreprod))
	if err != nil {
		t.Fatal(err)
	}
	// 1.50 with 6 decimals → 1_500_000 of USDM preprod.
	if asset.Amount != "1500000" {
		t.Errorf("unexpected money conversion: %s", asset.Amount)
	}
	if asset.Asset != cardano.USDMPreprodAsset {
		t.Errorf("expected USDM preprod default; got %s", asset.Asset)
	}
}

func TestParsePriceUnsupportedNetwork(t *testing.T) {
	s := NewExactCardanoScheme()
	_, err := s.ParsePrice("1", x402.Network("eip155:8453"))
	if err == nil {
		t.Fatal("expected unsupported network error")
	}
}

func TestEnhancePaymentRequirementsFillsDefaults(t *testing.T) {
	s := NewExactCardanoScheme()
	r := types.PaymentRequirements{
		Scheme:            "exact",
		Network:           cardano.CardanoPreprod,
		Asset:             cardano.LovelaceAsset,
		Amount:            "5000000",
		PayTo:             "addr_test1qx",
		MaxTimeoutSeconds: cardano.DefaultMaxTimeoutSeconds,
	}
	out, err := s.EnhancePaymentRequirements(
		context.Background(), r, types.SupportedKind{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if out.Extra["assetTransferMethod"] != cardano.AssetTransferMethodDefault {
		t.Errorf("expected default assetTransferMethod, got %v", out.Extra)
	}
}

func TestEnhancePaymentRequirementsMergesSupportedKindExtras(t *testing.T) {
	s := NewExactCardanoScheme()
	r := types.PaymentRequirements{
		Scheme:  "exact",
		Network: cardano.CardanoPreprod,
		Asset:   cardano.LovelaceAsset,
		Amount:  "5000000",
		PayTo:   "addr_test1qx",
		Extra:   map[string]interface{}{"assetTransferMethod": "default"},
	}
	supported := types.SupportedKind{
		Extra: map[string]interface{}{"feePayer": "addr_test1qfac", "scriptHash": "deadbeef"},
	}
	out, err := s.EnhancePaymentRequirements(
		context.Background(), r, supported, []string{"scriptHash"})
	if err != nil {
		t.Fatal(err)
	}
	// Server-side requirements always win (assetTransferMethod stayed "default").
	if out.Extra["assetTransferMethod"] != "default" {
		t.Errorf("server extras must not be overridden: %v", out.Extra)
	}
	// SupportedKind extras are mixed in for keys not already present.
	if out.Extra["feePayer"] != "addr_test1qfac" {
		t.Errorf("expected feePayer carried through: %v", out.Extra)
	}
	// Requested extension key gets propagated.
	if out.Extra["scriptHash"] != "deadbeef" {
		t.Errorf("expected scriptHash carried through: %v", out.Extra)
	}
}

func TestGetAssetDecimals(t *testing.T) {
	s := NewExactCardanoScheme()
	if d := s.GetAssetDecimals(cardano.LovelaceAsset, x402.Network(cardano.CardanoPreprod)); d != 6 {
		t.Errorf("expected 6 decimals, got %d", d)
	}
}
