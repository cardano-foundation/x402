package org.x402.cardano;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import org.x402.util.Json;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;

/**
 * V2 PaymentPayload envelope decoded from the {@code PAYMENT-SIGNATURE}
 * request header.
 *
 * <p>Wire format:
 * <pre>{@code
 * {
 *   "x402Version": 2,
 *   "payload":  { "transaction": "...", "nonce": "..." },
 *   "accepted": { ...payment requirements the client accepted... }
 * }
 * }</pre>
 *
 * <p>The header value itself is the base64 encoding of this JSON document.
 * Use {@link #fromHeader(String)} to decode and {@link #encodeHeader()} to
 * re-encode.
 *
 * <p>The {@code payload} field is intentionally a generic map so this class
 * can transit any future scheme; for Cardano, decode it with
 * {@link ExactCardanoPayload#fromMap(Map)}.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class CardanoPaymentPayload {

    /** Protocol version (always 2 for V2). */
    public int x402Version = 2;

    /** Scheme-specific payload (Cardano: transaction + nonce). */
    public Map<String, Object> payload;

    /** The PaymentRequirements block the client accepted. */
    public CardanoPaymentRequirements accepted;

    /** Default no-arg constructor (required by Jackson). */
    public CardanoPaymentPayload() {}

    /**
     * Decode a {@code PAYMENT-SIGNATURE} header value into a payload object.
     *
     * @param header base64-encoded JSON
     * @return parsed payload
     * @throws IllegalArgumentException when the header is not valid base64
     *     or the decoded JSON does not match the expected shape
     */
    public static CardanoPaymentPayload fromHeader(String header) {
        if (header == null || header.isEmpty()) {
            throw new IllegalArgumentException("PAYMENT-SIGNATURE header is empty");
        }
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(header);
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException(
                    "PAYMENT-SIGNATURE header is not valid base64", ex);
        }
        try {
            return Json.MAPPER.readValue(bytes, CardanoPaymentPayload.class);
        } catch (IOException ex) {
            throw new IllegalArgumentException(
                    "PAYMENT-SIGNATURE header is not a valid V2 PaymentPayload", ex);
        }
    }

    /**
     * Re-encode this payload as a base64 string suitable for the
     * {@code PAYMENT-SIGNATURE} header.
     *
     * @return base64-encoded JSON
     */
    public String encodeHeader() {
        try {
            String json = Json.MAPPER.writeValueAsString(this);
            return Base64.getEncoder().encodeToString(json.getBytes(StandardCharsets.UTF_8));
        } catch (IOException ex) {
            throw new IllegalStateException("Unable to encode PAYMENT-SIGNATURE header", ex);
        }
    }

    /**
     * Convenience accessor for the inner Cardano payload.
     *
     * @return the typed Cardano payload
     * @throws IllegalArgumentException when the payload map is missing
     *     required fields
     */
    public ExactCardanoPayload getCardanoPayload() {
        return ExactCardanoPayload.fromMap(payload);
    }

    /**
     * Round-trip raw JSON to a {@code JsonNode} for facilitator pass-through.
     *
     * <p>The facilitator endpoint expects {@code paymentPayload} as a JSON
     * object, not as a base64 header. Use this when forwarding the payload
     * after decoding it locally for sanity checks.
     *
     * @return JSON tree representing this payload
     */
    public JsonNode toJsonNode() {
        return Json.MAPPER.valueToTree(this);
    }
}
