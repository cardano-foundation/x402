package cardano

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
)

// ExactCardanoPayload is the inner Cardano-specific payload carried inside
// a v2 PaymentPayload's `payload` map.
//
// Wire format (JSON object inside paymentPayload.payload):
//
//	{ "transaction": "<base64 CBOR>", "nonce": "<txHashHex>#<index>" }
//
// transaction is a base64-encoded, fully signed Cardano CBOR transaction.
// nonce is a UTXO reference (txHashHex#index) that MUST also appear as a
// transaction input — the facilitator uses it to enforce uniqueness and
// replay protection (rule 5 of the spec).
type ExactCardanoPayload struct {
	Transaction string `json:"transaction"`
	Nonce       string `json:"nonce"`
}

// ToMap returns a JSON-shaped map suitable for stuffing into
// types.PaymentPayload.Payload.
func (p ExactCardanoPayload) ToMap() map[string]interface{} {
	return map[string]interface{}{
		"transaction": p.Transaction,
		"nonce":       p.Nonce,
	}
}

// ExactCardanoPayloadFromMap extracts a typed Cardano payload from the
// generic map form used by types.PaymentPayload.
//
// Returns an error if either field is missing or empty.
func ExactCardanoPayloadFromMap(raw map[string]interface{}) (ExactCardanoPayload, error) {
	if raw == nil {
		return ExactCardanoPayload{}, errors.New("Cardano payload is nil")
	}
	tx, _ := raw["transaction"].(string)
	if tx == "" {
		return ExactCardanoPayload{}, errors.New("Cardano payload is missing a transaction string")
	}
	nonce, _ := raw["nonce"].(string)
	if nonce == "" {
		return ExactCardanoPayload{}, errors.New("Cardano payload is missing a nonce string")
	}
	return ExactCardanoPayload{Transaction: tx, Nonce: nonce}, nil
}

// PaymentResponseHeader is the body of the PAYMENT-RESPONSE response header
// emitted on a successful settlement (base64-encoded JSON in the header).
//
// Wire format:
//
//	{
//	  "success":     true,
//	  "transaction": "<txhash>",
//	  "network":     "cardano:preprod",
//	  "payer":       "addr_test1q...",
//	  "extensions":  { "status": "confirmed" | "mempool" }
//	}
type PaymentResponseHeader struct {
	Success     bool                   `json:"success"`
	Transaction string                 `json:"transaction,omitempty"`
	Network     string                 `json:"network,omitempty"`
	Payer       string                 `json:"payer,omitempty"`
	Extensions  map[string]interface{} `json:"extensions,omitempty"`
}

// EncodeHeader returns the base64-encoded JSON suitable for the
// PAYMENT-RESPONSE response header.
func (h PaymentResponseHeader) EncodeHeader() (string, error) {
	body, err := json.Marshal(h)
	if err != nil {
		return "", fmt.Errorf("encoding PAYMENT-RESPONSE: %w", err)
	}
	return base64.StdEncoding.EncodeToString(body), nil
}
