package org.x402.cardano;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.ArrayList;
import java.util.List;

/**
 * V2 HTTP 402 challenge body emitted by a Cardano-protected resource server.
 *
 * <p>Wire format:
 * <pre>{@code
 * {
 *   "x402Version": 2,
 *   "error": "Payment required",
 *   "resource": {
 *     "url": "http://localhost:8003/premium",
 *     "description": "Cardano premium endpoint (5 tADA)",
 *     "mimeType": "application/json"
 *   },
 *   "accepts": [
 *     {
 *       "scheme": "exact",
 *       "network": "cardano:preprod",
 *       "payTo": "addr_test1qx...",
 *       "amount": "5000000",
 *       "asset": "lovelace",
 *       "maxTimeoutSeconds": 300,
 *       "extra": { "assetTransferMethod": "default" }
 *     }
 *   ]
 * }
 * }</pre>
 *
 * <p>The same JSON document — base64-encoded — is also placed in the
 * {@code PAYMENT-REQUIRED} response header so SPA clients that cannot read
 * the body (e.g. when CORS is restrictive) can still discover the challenge.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class CardanoPaymentRequired {

    /** Protocol version (always 2 for V2). */
    public int x402Version = 2;

    /** Error message — defaults to "Payment required" for the initial challenge. */
    public String error;

    /** Information about the resource being purchased (optional but recommended). */
    public ResourceInfo resource;

    /** Acceptable payment configurations. At least one entry is required. */
    public List<CardanoAccepts> accepts = new ArrayList<>();

    /** Default no-arg constructor (required by Jackson). */
    public CardanoPaymentRequired() {}
}
