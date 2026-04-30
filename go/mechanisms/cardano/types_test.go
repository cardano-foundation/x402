package cardano

import (
	"encoding/base64"
	"encoding/json"
	"testing"
)

func TestExactCardanoPayloadFromMap(t *testing.T) {
	good := map[string]interface{}{
		"transaction": "hKQA2QECgoJYIHCLvww0",
		"nonce":       "708bbf0c346333a3503b216a4d093b693aa295d302c6af464ecd6a976159a45b#3",
	}
	p, err := ExactCardanoPayloadFromMap(good)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if p.Transaction == "" || p.Nonce == "" {
		t.Fatalf("fields not populated: %+v", p)
	}

	// Missing transaction
	if _, err := ExactCardanoPayloadFromMap(map[string]interface{}{"nonce": "x#0"}); err == nil {
		t.Error("expected error for missing transaction")
	}
	// Missing nonce
	if _, err := ExactCardanoPayloadFromMap(map[string]interface{}{"transaction": "abc"}); err == nil {
		t.Error("expected error for missing nonce")
	}
	// Empty map
	if _, err := ExactCardanoPayloadFromMap(map[string]interface{}{}); err == nil {
		t.Error("expected error for empty map")
	}
	// Nil
	if _, err := ExactCardanoPayloadFromMap(nil); err == nil {
		t.Error("expected error for nil")
	}
}

func TestExactCardanoPayloadToMapRoundTrip(t *testing.T) {
	original := ExactCardanoPayload{
		Transaction: "hKQA2QECgoJYIHCLvww0",
		Nonce:       "abcdef00112233445566778899aabbccddeeff112233445566778899aabbccdd#7",
	}
	m := original.ToMap()
	got, err := ExactCardanoPayloadFromMap(m)
	if err != nil {
		t.Fatal(err)
	}
	if got != original {
		t.Errorf("round-trip mismatch: got %+v want %+v", got, original)
	}
}

func TestPaymentResponseHeaderEncoding(t *testing.T) {
	h := PaymentResponseHeader{
		Success:     true,
		Transaction: "abc123",
		Network:     CardanoPreprod,
		Extensions:  map[string]interface{}{"status": "confirmed"},
	}
	b64, err := h.EncodeHeader()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		t.Fatal(err)
	}
	var decoded PaymentResponseHeader
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if !decoded.Success || decoded.Transaction != "abc123" {
		t.Errorf("decoded mismatch: %+v", decoded)
	}
	if decoded.Network != CardanoPreprod {
		t.Errorf("network not preserved: %s", decoded.Network)
	}
	if decoded.Extensions["status"] != "confirmed" {
		t.Errorf("extensions not preserved: %v", decoded.Extensions)
	}
}

func TestPaymentResponseHeaderEncodingFailure(t *testing.T) {
	h := PaymentResponseHeader{
		Success:     false,
		Network:     CardanoPreprod,
		ErrorReason: "Utxo not found in utxo set",
	}
	b64, err := h.EncodeHeader()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		t.Fatal(err)
	}
	var decoded PaymentResponseHeader
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Success {
		t.Errorf("expected success=false: %+v", decoded)
	}
	if decoded.ErrorReason != "Utxo not found in utxo set" {
		t.Errorf("errorReason not preserved: %s", decoded.ErrorReason)
	}
}
