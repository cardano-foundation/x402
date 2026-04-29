package cardano

import "testing"

func TestParseUTXORef(t *testing.T) {
	tx := "708bbf0c346333a3503b216a4d093b693aa295d302c6af464ecd6a976159a45b"
	hash, idx, err := ParseUTXORef(tx + "#3")
	if err != nil {
		t.Fatal(err)
	}
	if hash != tx {
		t.Errorf("tx hash mismatch: %s", hash)
	}
	if idx != 3 {
		t.Errorf("index mismatch: %d", idx)
	}
	// Uppercase is normalised to lower.
	hash, _, err = ParseUTXORef("ABCDEF" + tx[6:] + "#0")
	if err != nil {
		t.Fatal(err)
	}
	if hash[0] != 'a' {
		t.Errorf("expected lowercased tx hash, got %q", hash)
	}
	if _, _, err := ParseUTXORef("invalid"); err == nil {
		t.Error("expected error on missing #index")
	}
}

func TestParseAssetUnit(t *testing.T) {
	// Lovelace returns empty parts.
	policy, name, err := ParseAssetUnit("lovelace")
	if err != nil || policy != "" || name != "" {
		t.Errorf("expected empty parts for lovelace; got policy=%q name=%q err=%v",
			policy, name, err)
	}
	// Native token splits.
	policy, name, err = ParseAssetUnit(USDMPreprodAsset)
	if err != nil {
		t.Fatal(err)
	}
	if policy != USDMPreprodPolicyID {
		t.Errorf("policy mismatch: %s", policy)
	}
	if name != USDMAssetNameHex {
		t.Errorf("name mismatch: %s", name)
	}
	if _, _, err := ParseAssetUnit("nonsense"); err == nil {
		t.Error("expected error for invalid asset")
	}
}

func TestConvertToTokenAmount(t *testing.T) {
	cases := []struct {
		in       string
		decimals int
		want     string
	}{
		{"1", 6, "1000000"},
		{"1.50", 6, "1500000"},
		{"0.000001", 6, "1"},
		{"5", 6, "5000000"},
	}
	for _, c := range cases {
		got, err := ConvertToTokenAmount(c.in, c.decimals)
		if err != nil {
			t.Errorf("%s: unexpected error: %v", c.in, err)
			continue
		}
		if got != c.want {
			t.Errorf("ConvertToTokenAmount(%q,%d)=%q want %q", c.in, c.decimals, got, c.want)
		}
	}
	// Too many decimals → error.
	if _, err := ConvertToTokenAmount("0.0000001", 6); err == nil {
		t.Error("expected error when amount has more decimals than allowed")
	}
}

func TestParseMoneyToDecimal(t *testing.T) {
	cases := map[interface{}]string{
		"$1.50":      "1.50",
		"1.50":       "1.50",
		" 1.5 USDM ": "1.5",
		"3 USD":      "3",
		1.50:         "1.5",
		2:            "2",
		int64(7):     "7",
	}
	for in, want := range cases {
		got, err := ParseMoneyToDecimal(in)
		if err != nil {
			t.Errorf("%v: unexpected error: %v", in, err)
			continue
		}
		if got != want {
			t.Errorf("ParseMoneyToDecimal(%v)=%q want %q", in, got, want)
		}
	}
	if _, err := ParseMoneyToDecimal(struct{}{}); err == nil {
		t.Error("expected error for unsupported type")
	}
}

func TestValidateAddress(t *testing.T) {
	if err := ValidateAddress("addr_test1qzfoo"); err != nil {
		t.Errorf("expected valid testnet address, got %v", err)
	}
	if err := ValidateAddress("addr1qfoo"); err != nil {
		t.Errorf("expected valid mainnet address, got %v", err)
	}
	if err := ValidateAddress("0xinvalid"); err == nil {
		t.Error("expected invalid address rejected")
	}
}
