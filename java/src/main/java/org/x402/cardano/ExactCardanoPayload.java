package org.x402.cardano;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.Map;

/**
 * Inner Cardano-specific payload carried inside a {@link CardanoPaymentPayload}.
 *
 * <p>Wire format (becomes {@code paymentPayload.payload}):
 * <pre>{@code
 * { "transaction": "<base64 CBOR>", "nonce": "<txHashHex>#<index>" }
 * }</pre>
 *
 * <p><strong>transaction</strong> is a base64-encoded, fully signed Cardano
 * CBOR transaction. The facilitator decodes it with pycardano (Python) /
 * cardano-serialization-lib (TypeScript) to verify the six rules.
 *
 * <p><strong>nonce</strong> is a UTXO reference (txHashHex#index) that MUST
 * also appear as a transaction input. The facilitator uses the nonce to
 * enforce uniqueness and replay protection (rule 5 of the spec).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ExactCardanoPayload {

    /** Base64-encoded signed Cardano CBOR transaction. */
    public String transaction;

    /** UTXO reference ({@code txHashHex#index}) appearing as a tx input. */
    public String nonce;

    /** Default no-arg constructor (required by Jackson). */
    public ExactCardanoPayload() {}

    /**
     * Convenience constructor.
     *
     * @param transaction base64-encoded signed CBOR transaction
     * @param nonce UTXO reference (txHashHex#index)
     */
    public ExactCardanoPayload(String transaction, String nonce) {
        this.transaction = transaction;
        this.nonce = nonce;
    }

    /**
     * Extract a typed Cardano payload from the generic map shape used by
     * {@link CardanoPaymentPayload}.
     *
     * @param raw payload map (as deserialized from JSON)
     * @return the typed payload
     * @throws IllegalArgumentException when {@code transaction} or
     *     {@code nonce} are missing or empty
     */
    public static ExactCardanoPayload fromMap(Map<String, Object> raw) {
        if (raw == null) {
            throw new IllegalArgumentException("Cardano payload is null");
        }
        Object tx = raw.get("transaction");
        Object n = raw.get("nonce");
        if (!(tx instanceof String) || ((String) tx).isEmpty()) {
            throw new IllegalArgumentException(
                    "Cardano payload is missing a transaction string");
        }
        if (!(n instanceof String) || ((String) n).isEmpty()) {
            throw new IllegalArgumentException("Cardano payload is missing a nonce string");
        }
        return new ExactCardanoPayload((String) tx, (String) n);
    }
}
