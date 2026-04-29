package cardano

import (
	"regexp"
	"testing"
)

func TestIsCardanoNetwork(t *testing.T) {
	cases := map[string]bool{
		"cardano:mainnet":   true,
		"cardano:preprod":   true,
		"cardano:preview":   true,
		"eip155:8453":       false,
		"solana:mainnet":    false,
		"":                  false,
	}
	for input, want := range cases {
		got := IsCardanoNetwork(input)
		if got != want {
			t.Errorf("IsCardanoNetwork(%q) = %v, want %v", input, got, want)
		}
	}
}

func TestGetNetworkConfig(t *testing.T) {
	cfg, err := GetNetworkConfig(CardanoMainnet)
	if err != nil || cfg.NetworkID != NetworkIDMainnet {
		t.Fatalf("expected mainnet network id 1, got cfg=%+v err=%v", cfg, err)
	}
	cfg, err = GetNetworkConfig(CardanoPreprod)
	if err != nil || cfg.NetworkID != NetworkIDTestnet {
		t.Fatalf("expected preprod network id 0, got cfg=%+v err=%v", cfg, err)
	}
	if _, err := GetNetworkConfig("not-a-network"); err == nil {
		t.Fatal("expected error for unknown network")
	}
}

func TestAssetRegex(t *testing.T) {
	re := regexp.MustCompile(CardanoAssetRegex)
	policy := "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad"
	cases := map[string]bool{
		"lovelace":                             true,
		policy + ".0014df105553444d":           true,
		"LOVELACE":                             false, // case-sensitive in spec
		"0xtoken":                              false,
		policy:                                 false, // no dot
	}
	for input, want := range cases {
		if got := re.MatchString(input); got != want {
			t.Errorf("asset regex(%q) = %v, want %v", input, got, want)
		}
	}
}

func TestUTXORefRegex(t *testing.T) {
	re := regexp.MustCompile(CardanoUTXORefRegex)
	tx := "708bbf0c346333a3503b216a4d093b693aa295d302c6af464ecd6a976159a45b"
	if !re.MatchString(tx + "#3") {
		t.Error("expected utxo ref regex to accept canonical form")
	}
	if re.MatchString(tx) {
		t.Error("utxo ref regex must require '#index'")
	}
	if re.MatchString("xy#0") {
		t.Error("utxo ref regex must require 64-hex tx hash")
	}
}
