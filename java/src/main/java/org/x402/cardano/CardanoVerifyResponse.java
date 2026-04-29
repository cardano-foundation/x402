package org.x402.cardano;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Response DTO returned by the facilitator's {@code POST /verify} endpoint.
 *
 * <p>Wire format (camelCase, with snake_case aliases for cross-SDK compatibility):
 * <pre>{@code
 * {
 *   "isValid": false,
 *   "invalidReason": "exact_cardano_facilitator_chain_lookup_failed",
 *   "invalidMessage": "Blockfrost /tx/utxos returned 502",
 *   "payer": "addr_test1q..."
 * }
 * }</pre>
 *
 * <p>{@code invalidReason} values come from {@link CardanoConstants}.
 * {@code payer} is populated even on failure when the facilitator could
 * resolve the input address from the chain.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class CardanoVerifyResponse {

    /** True when the payment is valid; false otherwise. */
    @JsonProperty("isValid")
    @JsonAlias({"is_valid"})
    public boolean isValid;

    /** Stable machine-readable reason code; null on success. */
    @JsonProperty("invalidReason")
    @JsonAlias({"invalid_reason"})
    public String invalidReason;

    /** Free-form human-readable explanation; null on success. */
    @JsonProperty("invalidMessage")
    @JsonAlias({"invalid_message"})
    public String invalidMessage;

    /** Payer's bech32 address (best-effort, may be null). */
    public String payer;

    /** Default no-arg constructor (required by Jackson). */
    public CardanoVerifyResponse() {}
}
