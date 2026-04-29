package org.x402.cardano;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * V2 price block: an asset unit + an atomic amount.
 *
 * <p>Wire format (under {@code accepts[].price} for outgoing 402 challenges
 * and inside {@code accepts[]} flattened on requirements posted to a
 * facilitator):
 * <pre>{@code
 * { "amount": "5000000", "asset": "lovelace" }
 * }</pre>
 *
 * <p>{@code amount} is always a decimal string in the asset's smallest unit
 * (lovelace for ADA, the asset's native decimals for native tokens).
 * {@code asset} is either the literal {@code "lovelace"} or a
 * {@code policyId.assetNameHex} pair as defined in {@link CardanoConstants}.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class Price {

    /** Amount in the asset's smallest unit (e.g. lovelace for ADA). */
    public String amount;

    /** Asset unit ({@code "lovelace"} or {@code policyId.assetNameHex}). */
    public String asset;

    /** Default no-arg constructor (required by Jackson). */
    public Price() {}

    /**
     * Convenience constructor.
     *
     * @param amount amount in smallest unit (decimal string)
     * @param asset asset unit ({@code "lovelace"} or {@code policyId.assetNameHex})
     */
    public Price(String amount, String asset) {
        this.amount = amount;
        this.asset = asset;
    }
}
