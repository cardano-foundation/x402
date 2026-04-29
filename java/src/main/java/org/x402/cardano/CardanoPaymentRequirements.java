package org.x402.cardano;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.HashMap;
import java.util.Map;

/**
 * V2 payment requirements for a Cardano `exact` payment.
 *
 * <p>This is the wire shape posted both:
 * <ul>
 *   <li>inside the {@code accepts} array of a 402 challenge, and</li>
 *   <li>as the {@code paymentRequirements} field of {@code /verify} and
 *       {@code /settle} calls to a facilitator.</li>
 * </ul>
 *
 * <p>Wire format:
 * <pre>{@code
 * {
 *   "scheme": "exact",
 *   "network": "cardano:preprod",
 *   "asset":   "lovelace",
 *   "amount":  "5000000",
 *   "payTo":   "addr_test1qx...",
 *   "maxTimeoutSeconds": 300,
 *   "extra":   { "assetTransferMethod": "default" }
 * }
 * }</pre>
 *
 * <p>The {@code price} object used in the public 402 response (see
 * {@link CardanoAccepts}) is flattened into {@code amount} + {@code asset}
 * here because that is what the facilitator's {@code /verify} endpoint
 * consumes.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class CardanoPaymentRequirements {

    /** Scheme identifier — always {@code "exact"} for Cardano. */
    public String scheme = CardanoConstants.SCHEME_EXACT;

    /** x402 Cardano network identifier (e.g. {@code "cardano:preprod"}). */
    public String network;

    /** Asset unit (see {@link CardanoConstants#CARDANO_ASSET_REGEX}). */
    public String asset;

    /** Amount in the asset's smallest unit (decimal string). */
    public String amount;

    /** Bech32 recipient address. */
    public String payTo;

    /** Maximum payment validity in seconds; defaults to 300 (5 minutes). */
    public int maxTimeoutSeconds = CardanoConstants.DEFAULT_MAX_TIMEOUT_SECONDS;

    /** Mechanism-specific extras (e.g. {@code assetTransferMethod}). */
    public Map<String, Object> extra = new HashMap<>();

    /** Default no-arg constructor (required by Jackson). */
    public CardanoPaymentRequirements() {}

    /**
     * Build a Cardano payment requirements block.
     *
     * @param network x402 network identifier (e.g. {@code "cardano:preprod"})
     * @param asset asset unit ({@code "lovelace"} or {@code policyId.assetNameHex})
     * @param amount amount in smallest unit (decimal string)
     * @param payTo bech32 recipient address
     * @return a fully-populated requirements object with default timeout and
     *     {@code assetTransferMethod = "default"}
     */
    public static CardanoPaymentRequirements forDefaultTransfer(
            String network, String asset, String amount, String payTo) {
        CardanoPaymentRequirements req = new CardanoPaymentRequirements();
        req.network = network;
        req.asset = asset;
        req.amount = amount;
        req.payTo = payTo;
        req.extra.put(
                "assetTransferMethod", CardanoConstants.ASSET_TRANSFER_METHOD_DEFAULT);
        return req;
    }
}
