package org.x402.cardano;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Map;

/**
 * Response DTO returned by the facilitator's {@code POST /settle} endpoint.
 *
 * <p>Wire format:
 * <pre>{@code
 * {
 *   "success": true,
 *   "errorReason": null,
 *   "errorMessage": null,
 *   "payer": "addr_test1q...",
 *   "transaction": "<txhash>",
 *   "network": "cardano:preprod",
 *   "extensions": { "status": "confirmed" }
 * }
 * }</pre>
 *
 * <p>The {@code extensions.status} field is Cardano-specific and reports
 * whether the transaction reached chain finality ({@code "confirmed"}) or
 * was only accepted into the mempool ({@code "mempool"}).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class CardanoSettleResponse {

    /** True when settlement succeeded. */
    public boolean success;

    /** Machine-readable error reason; null on success. */
    @JsonProperty("errorReason")
    @JsonAlias({"error_reason"})
    public String errorReason;

    /** Human-readable error message; null on success. */
    @JsonProperty("errorMessage")
    @JsonAlias({"error_message"})
    public String errorMessage;

    /** Payer bech32 address (best-effort). */
    public String payer;

    /** Cardano transaction hash returned by the chain on submit. */
    public String transaction;

    /** x402 Cardano network identifier (e.g. {@code "cardano:preprod"}). */
    public String network;

    /** Extension data (Cardano populates {@code extensions.status}). */
    public Map<String, Object> extensions;

    /** Optional final amount field (mirrors V2 spec). */
    public String amount;

    /** Default no-arg constructor (required by Jackson). */
    public CardanoSettleResponse() {}
}
