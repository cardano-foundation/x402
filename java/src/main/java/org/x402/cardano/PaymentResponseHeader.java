package org.x402.cardano;

import com.fasterxml.jackson.annotation.JsonInclude;
import org.x402.util.Json;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;

/**
 * Body of the {@code PAYMENT-RESPONSE} response header emitted on a
 * successful settlement.
 *
 * <p>Wire format (base64-encoded JSON in the header value):
 * <pre>{@code
 * {
 *   "success":     true,
 *   "transaction": "<txhash>",
 *   "network":     "cardano:preprod",
 *   "extensions":  { "status": "confirmed" },
 *   "errorReason": "Utxo not found in utxo set"
 * }
 * }</pre>
 *
 * <p>Clients (typically a wallet UI) decode this header to display tx hashes
 * and confirmation state to the user. {@code errorReason} is only populated
 * when {@code success} is {@code false}.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class PaymentResponseHeader {

    /** Always true when this header is sent (settle succeeded). */
    public boolean success = true;

    /** Cardano transaction hash. */
    public String transaction;

    /** Network identifier echoed from the requirements. */
    public String network;

    /** Extension data — for Cardano, {@code {"status": "confirmed" | "mempool"}}. */
    public Map<String, Object> extensions;

    /** Optional error reason when {@code success} is {@code false}. */
    public String errorReason;

    /** Default no-arg constructor (required by Jackson). */
    public PaymentResponseHeader() {}

    /**
     * Build a header object from a {@link CardanoSettleResponse}.
     *
     * @param settle the facilitator settle response
     * @return a header DTO suitable for {@link #encode()}
     */
    public static PaymentResponseHeader fromSettle(CardanoSettleResponse settle) {
        PaymentResponseHeader h = new PaymentResponseHeader();
        h.success = settle.success;
        h.transaction = settle.transaction;
        h.network = settle.network;
        h.extensions = settle.extensions;
        h.errorReason = settle.errorReason;
        return h;
    }

    /**
     * Encode this header as a base64 string for HTTP transport.
     *
     * @return base64-encoded JSON
     */
    public String encode() {
        try {
            String json = Json.MAPPER.writeValueAsString(this);
            return Base64.getEncoder().encodeToString(json.getBytes(StandardCharsets.UTF_8));
        } catch (IOException ex) {
            throw new IllegalStateException("Unable to encode PAYMENT-RESPONSE header", ex);
        }
    }
}
