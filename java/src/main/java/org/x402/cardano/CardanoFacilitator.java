package org.x402.cardano;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;

/**
 * Facilitator-side contract for the Cardano `exact` mechanism.
 *
 * <p>Resource servers depend on this interface (not the concrete
 * {@link CardanoFacilitatorClient}) so they can be wired against an
 * in-process implementation in tests, or replaced with a custom transport
 * (e.g. gRPC, message bus) without changing application code.
 */
public interface CardanoFacilitator {

    /**
     * Verify a payment.
     *
     * @param payload payment payload decoded from the {@code PAYMENT-SIGNATURE} header
     * @param requirements canonical, server-supplied requirements
     * @return the verify response
     * @throws IOException on transport failure
     * @throws InterruptedException if the calling thread is interrupted
     */
    CardanoVerifyResponse verify(
            CardanoPaymentPayload payload, CardanoPaymentRequirements requirements)
            throws IOException, InterruptedException;

    /**
     * Settle (broadcast) a previously verified payment.
     *
     * @param payload same payload submitted to {@link #verify}
     * @param requirements canonical requirements
     * @return the settle response
     * @throws IOException on transport failure
     * @throws InterruptedException if the calling thread is interrupted
     */
    CardanoSettleResponse settle(
            CardanoPaymentPayload payload, CardanoPaymentRequirements requirements)
            throws IOException, InterruptedException;

    /**
     * Discover what the facilitator supports.
     *
     * @return raw {@code /supported} JSON tree
     * @throws IOException on transport failure
     * @throws InterruptedException if the calling thread is interrupted
     */
    JsonNode supported() throws IOException, InterruptedException;
}
