package org.x402.cardano;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Describes the resource the client is paying for.
 *
 * <p>Returned in 402 challenges so wallets / aggregators can present the user
 * with context about what they are about to pay for.
 *
 * <p>Wire format:
 * <pre>{@code
 * { "url": "http://localhost:8003/premium",
 *   "description": "Cardano premium endpoint (5 tADA)",
 *   "mimeType": "application/json" }
 * }</pre>
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ResourceInfo {

    /** Absolute URL of the protected resource. */
    public String url;

    /** Human-readable description; optional. */
    public String description;

    /** Expected MIME type of the response; optional. */
    public String mimeType;

    /** Default no-arg constructor (required by Jackson). */
    public ResourceInfo() {}

    /**
     * Convenience constructor.
     *
     * @param url absolute URL of the resource
     * @param description optional description
     * @param mimeType optional MIME type
     */
    public ResourceInfo(String url, String description, String mimeType) {
        this.url = url;
        this.description = description;
        this.mimeType = mimeType;
    }
}
