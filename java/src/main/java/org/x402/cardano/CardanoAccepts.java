package org.x402.cardano;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.HashMap;
import java.util.Map;

/**
 * One entry in the {@code accepts[]} array of a V2 402 challenge.
 *
 * <p>Wire format:
 * <pre>{@code
 * {
 *   "scheme":  "exact",
 *   "network": "cardano:preprod",
 *   "payTo":   "addr_test1qx...",
 *   "amount":  "5000000",
 *   "asset":   "lovelace",
 *   "maxTimeoutSeconds": 300,
 *   "extra":   { "assetTransferMethod": "default" }
 * }
 * }</pre>
 *
 * <p>This is structurally a flattened {@link CardanoPaymentRequirements} —
 * separating it as its own type keeps the 402 response shape decoupled from
 * the facilitator's request shape and matches the TS/Python references.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class CardanoAccepts {

    /** Scheme identifier — always {@code "exact"} for Cardano. */
    public String scheme = CardanoConstants.SCHEME_EXACT;

    /** x402 Cardano network identifier (e.g. {@code "cardano:preprod"}). */
    public String network;

    /** Bech32 recipient address. */
    public String payTo;

    /** Amount in the asset's smallest unit (decimal string). */
    public String amount;

    /** Asset unit (see {@link CardanoConstants#CARDANO_ASSET_REGEX}). */
    public String asset;

    /** Maximum payment validity in seconds. */
    public int maxTimeoutSeconds = CardanoConstants.DEFAULT_MAX_TIMEOUT_SECONDS;

    /** Mechanism-specific extras (e.g. {@code assetTransferMethod}). */
    public Map<String, Object> extra = new HashMap<>();

    /** Default no-arg constructor (required by Jackson). */
    public CardanoAccepts() {}

    /**
     * Build a default-method Cardano accepts entry.
     *
     * @param network x402 network identifier
     * @param payTo bech32 recipient address
     * @param amount amount in smallest unit
     * @param asset asset unit
     * @return a fully populated accepts entry
     */
    public static CardanoAccepts forDefaultTransfer(
            String network, String payTo, String amount, String asset) {
        CardanoAccepts a = new CardanoAccepts();
        a.network = network;
        a.payTo = payTo;
        a.amount = amount;
        a.asset = asset;
        a.extra.put(
                "assetTransferMethod", CardanoConstants.ASSET_TRANSFER_METHOD_DEFAULT);
        return a;
    }
}
