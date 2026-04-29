package org.x402.cardano;

import com.fasterxml.jackson.databind.JsonNode;
import org.x402.util.Json;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * HTTP client for an x402 V2 facilitator that supports the Cardano `exact`
 * scheme.
 *
 * <p>Both calls submit JSON of the form
 * <pre>{@code
 * {
 *   "x402Version": 2,
 *   "paymentPayload":      { ...CardanoPaymentPayload... },
 *   "paymentRequirements": { ...CardanoPaymentRequirements... }
 * }
 * }</pre>
 * and parse the response body as {@link CardanoVerifyResponse} or
 * {@link CardanoSettleResponse} respectively.
 *
 * <p>Use this client from a Cardano-protected resource server (see
 * {@link CardanoPaymentFilter}); a typical deployment runs the facilitator
 * as a separate service backed by a chain provider such as Blockfrost.
 */
public class CardanoFacilitatorClient implements CardanoFacilitator {

    private final HttpClient http;
    private final String baseUrl;

    /**
     * Create a facilitator client with sensible defaults (5s connect timeout,
     * HTTP/1.1).
     *
     * <p>HTTP/1.1 is forced (instead of the JDK's default of HTTP/2) because
     * the reference Python facilitator runs on uvicorn, which does not handle
     * the {@code Upgrade: h2c} negotiation that JDK HttpClient emits on
     * cleartext HTTP. Leaving the default would cause uvicorn to log
     * "Unsupported upgrade request" and silently drop the request body,
     * surfacing as a Pydantic 422 about a missing body.
     *
     * @param baseUrl base URL of the facilitator (trailing slash trimmed)
     */
    public CardanoFacilitatorClient(String baseUrl) {
        this(
                baseUrl,
                HttpClient.newBuilder()
                        .connectTimeout(Duration.ofSeconds(5))
                        .version(HttpClient.Version.HTTP_1_1)
                        .build());
    }

    /**
     * Create a facilitator client with a caller-supplied {@link HttpClient}.
     *
     * @param baseUrl base URL of the facilitator
     * @param http preconfigured HTTP client (must not be null)
     */
    public CardanoFacilitatorClient(String baseUrl, HttpClient http) {
        Objects.requireNonNull(baseUrl, "baseUrl");
        Objects.requireNonNull(http, "http");
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        this.http = http;
    }

    /**
     * Call {@code POST /verify} on the facilitator.
     *
     * @param payload payment payload decoded from the {@code PAYMENT-SIGNATURE} header
     * @param requirements requirements being fulfilled (server-supplied, canonical)
     * @return the facilitator's verify response
     * @throws IOException on transport / non-2xx response
     * @throws InterruptedException if the calling thread is interrupted
     */
    @Override
    public CardanoVerifyResponse verify(
            CardanoPaymentPayload payload, CardanoPaymentRequirements requirements)
            throws IOException, InterruptedException {
        String body = Json.MAPPER.writeValueAsString(buildEnvelope(payload, requirements));
        HttpResponse<String> response = post("/verify", body);
        if (response.statusCode() / 100 != 2) {
            throw new IOException(
                    "Facilitator /verify returned HTTP "
                            + response.statusCode()
                            + ": "
                            + response.body());
        }
        return Json.MAPPER.readValue(response.body(), CardanoVerifyResponse.class);
    }

    /**
     * Call {@code POST /settle} on the facilitator.
     *
     * @param payload payment payload (same as verified)
     * @param requirements requirements being fulfilled
     * @return the facilitator's settle response
     * @throws IOException on transport / non-2xx response
     * @throws InterruptedException if the calling thread is interrupted
     */
    @Override
    public CardanoSettleResponse settle(
            CardanoPaymentPayload payload, CardanoPaymentRequirements requirements)
            throws IOException, InterruptedException {
        String body = Json.MAPPER.writeValueAsString(buildEnvelope(payload, requirements));
        HttpResponse<String> response = post("/settle", body);
        if (response.statusCode() / 100 != 2) {
            throw new IOException(
                    "Facilitator /settle returned HTTP "
                            + response.statusCode()
                            + ": "
                            + response.body());
        }
        return Json.MAPPER.readValue(response.body(), CardanoSettleResponse.class);
    }

    /**
     * Call {@code GET /supported} on the facilitator and return the raw JSON.
     *
     * <p>Resource servers can call this on startup to verify the facilitator
     * supports the Cardano `exact` scheme on the requested network.
     *
     * @return parsed JSON tree of the {@code /supported} response
     * @throws IOException on transport / non-2xx response
     * @throws InterruptedException if the calling thread is interrupted
     */
    @Override
    public JsonNode supported() throws IOException, InterruptedException {
        HttpRequest request =
                HttpRequest.newBuilder()
                        .uri(URI.create(baseUrl + "/supported"))
                        .timeout(Duration.ofSeconds(30))
                        .version(HttpClient.Version.HTTP_1_1)
                        .GET()
                        .build();
        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() / 100 != 2) {
            throw new IOException(
                    "Facilitator /supported returned HTTP "
                            + response.statusCode()
                            + ": "
                            + response.body());
        }
        return Json.MAPPER.readTree(response.body());
    }

    /* --------------------------------------------------------------- */

    private Map<String, Object> buildEnvelope(
            CardanoPaymentPayload payload, CardanoPaymentRequirements requirements) {
        Map<String, Object> env = new LinkedHashMap<>();
        env.put("x402Version", 2);
        env.put("paymentPayload", payload);
        env.put("paymentRequirements", requirements);
        return env;
    }

    private HttpResponse<String> post(String path, String body)
            throws IOException, InterruptedException {
        HttpRequest request =
                HttpRequest.newBuilder()
                        .uri(URI.create(baseUrl + path))
                        .timeout(Duration.ofSeconds(60))
                        .version(HttpClient.Version.HTTP_1_1)
                        .header("Content-Type", "application/json")
                        .header("Accept", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(body))
                        .build();
        return http.send(request, HttpResponse.BodyHandlers.ofString());
    }
}
