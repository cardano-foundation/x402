package org.x402.cardano;

import java.util.Objects;

/**
 * Per-route configuration consumed by {@link CardanoPaymentFilter}.
 *
 * <p>Bundles the {@link CardanoAccepts} block published in 402 challenges
 * with optional resource metadata. The same configuration is used to build
 * both the public 402 challenge (where {@code description} and
 * {@code mimeType} go into the {@link ResourceInfo}) and the canonical
 * {@link CardanoPaymentRequirements} forwarded to the facilitator.
 */
public final class RouteConfig {

    /** The Cardano accepts block (network, payTo, amount, asset, extra, ...). */
    public final CardanoAccepts accepts;

    /** Human-readable description published in the 402 challenge (optional). */
    public final String description;

    /** MIME type of the protected resource (optional). */
    public final String mimeType;

    /**
     * Build a route configuration.
     *
     * @param accepts Cardano accepts block (must not be null)
     * @param description optional description for the 402 challenge
     * @param mimeType optional MIME type for the 402 challenge
     */
    public RouteConfig(CardanoAccepts accepts, String description, String mimeType) {
        this.accepts = Objects.requireNonNull(accepts, "accepts");
        this.description = description;
        this.mimeType = mimeType;
    }

    /**
     * Convenience factory using {@link CardanoAccepts#forDefaultTransfer}.
     *
     * @param network x402 network identifier
     * @param payTo bech32 recipient address
     * @param amount amount in smallest unit (decimal string)
     * @param asset asset unit
     * @param description optional description
     * @param mimeType optional MIME type
     * @return a route configuration with default-method accepts
     */
    public static RouteConfig forDefault(
            String network,
            String payTo,
            String amount,
            String asset,
            String description,
            String mimeType) {
        CardanoAccepts a = CardanoAccepts.forDefaultTransfer(network, payTo, amount, asset);
        return new RouteConfig(a, description, mimeType);
    }
}
