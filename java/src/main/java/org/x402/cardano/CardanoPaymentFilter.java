package org.x402.cardano;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.x402.util.Json;

import java.io.IOException;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

/**
 * Servlet filter that enforces x402 V2 Cardano payments on selected routes.
 *
 * <p>Wire-protocol responsibilities:
 * <ol>
 *   <li>If the request hits a protected route and carries no
 *       {@code PAYMENT-SIGNATURE} header → return HTTP 402 with a
 *       {@link CardanoPaymentRequired} JSON body and the same body
 *       base64-encoded in the {@code PAYMENT-REQUIRED} response header.</li>
 *   <li>If a header is present, decode it, post {@code paymentPayload} +
 *       {@code paymentRequirements} to the facilitator's {@code /verify}.
 *       On failure return 402 with the facilitator's reason code.</li>
 *   <li>On verify success, invoke the downstream handler.</li>
 *   <li>If the handler returns &lt; 400, call {@code /settle}. Success → set
 *       a {@code PAYMENT-RESPONSE} header (base64 JSON). Failure → 402.</li>
 * </ol>
 *
 * <p>Path matching is exact and case-sensitive on
 * {@link HttpServletRequest#getRequestURI()}. Paths not present in the
 * route map are passed through with no payment check.
 *
 * <p>Thread-safe: the filter holds an immutable route map and stateless
 * dependencies (the facilitator client is itself thread-safe under the
 * standard Java HttpClient).
 *
 * <p>Example:
 * <pre>{@code
 * Map<String, RouteConfig> routes = Map.of(
 *     "/premium", RouteConfig.forDefault(
 *         CardanoConstants.CARDANO_PREPROD,
 *         "addr_test1q...", "5000000",
 *         CardanoConstants.LOVELACE_ASSET,
 *         "Cardano premium endpoint (5 tADA)",
 *         "application/json"));
 *
 * CardanoFacilitatorClient facilitator =
 *     new CardanoFacilitatorClient("http://facilitator:8080");
 * CardanoPaymentFilter filter = new CardanoPaymentFilter(facilitator, routes);
 * }</pre>
 */
public class CardanoPaymentFilter implements Filter {

    /** Request header carrying the base64-encoded V2 PaymentPayload. */
    public static final String HDR_PAYMENT_SIGNATURE = "PAYMENT-SIGNATURE";

    /** Response header carrying the base64-encoded V2 PaymentRequired body. */
    public static final String HDR_PAYMENT_REQUIRED = "PAYMENT-REQUIRED";

    /** Response header carrying the base64-encoded settlement response. */
    public static final String HDR_PAYMENT_RESPONSE = "PAYMENT-RESPONSE";

    private final CardanoFacilitator facilitator;
    private final Map<String, RouteConfig> routes;

    /**
     * Create the filter.
     *
     * @param facilitator V2 Cardano facilitator (typically a
     *     {@link CardanoFacilitatorClient}, but any implementation works)
     * @param routes immutable route map: URI path → {@link RouteConfig}
     */
    public CardanoPaymentFilter(
            CardanoFacilitator facilitator, Map<String, RouteConfig> routes) {
        this.facilitator = Objects.requireNonNull(facilitator, "facilitator");
        this.routes = Map.copyOf(Objects.requireNonNull(routes, "routes"));
    }

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {

        if (!(req instanceof HttpServletRequest) || !(res instanceof HttpServletResponse)) {
            chain.doFilter(req, res);
            return;
        }
        HttpServletRequest request = (HttpServletRequest) req;
        HttpServletResponse response = (HttpServletResponse) res;

        // Always allow CORS preflight through.
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            chain.doFilter(req, res);
            return;
        }

        RouteConfig route = routes.get(request.getRequestURI());
        if (route == null) {
            chain.doFilter(req, res);
            return;
        }

        String header = request.getHeader(HDR_PAYMENT_SIGNATURE);
        if (header == null || header.isEmpty()) {
            respondWithChallenge(request, response, route, "Payment required");
            return;
        }

        // ---- Decode & verify -----------------------------------------------
        CardanoPaymentPayload payload;
        try {
            payload = CardanoPaymentPayload.fromHeader(header);
        } catch (IllegalArgumentException ex) {
            respondWithChallenge(request, response, route, CardanoConstants.ERR_INVALID_PAYLOAD);
            return;
        }
        // SECURITY: the facilitator is given the SERVER-supplied requirements
        // as the canonical truth, NOT what the client put in `accepted`.
        CardanoPaymentRequirements requirements = toRequirements(route.accepts);

        CardanoVerifyResponse verify;
        try {
            verify = facilitator.verify(payload, requirements);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            writeServerError(response, "Payment verification interrupted");
            return;
        } catch (IOException ex) {
            writeServerError(response, "Payment verification failed: " + ex.getMessage());
            return;
        } catch (RuntimeException ex) {
            writeServerError(response, "Internal server error during payment verification");
            return;
        }
        if (!verify.isValid) {
            String reason =
                    verify.invalidReason != null
                            ? verify.invalidReason
                            : "verification_failed";
            respondWithChallenge(request, response, route, reason);
            return;
        }

        // ---- Run protected handler -----------------------------------------
        chain.doFilter(req, res);

        // ---- Settle (only on a successful application response) ------------
        if (response.getStatus() >= 400) {
            return;
        }

        CardanoSettleResponse settle;
        try {
            settle = facilitator.settle(payload, requirements);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            tryRespondAfterCommit(response, route, "settlement interrupted");
            return;
        } catch (IOException ex) {
            tryRespondAfterCommit(response, route, "settlement error: " + ex.getMessage());
            return;
        } catch (RuntimeException ex) {
            tryRespondAfterCommit(
                    response, route, "settlement error: " + ex.getClass().getSimpleName());
            return;
        }

        if (!settle.success) {
            String reason =
                    settle.errorReason != null
                            ? settle.errorReason
                            : CardanoConstants.ERR_SETTLEMENT_FAILED;
            tryRespondAfterCommit(response, route, reason);
            return;
        }

        // Success: emit the PAYMENT-RESPONSE header so wallet UIs can show
        // the resulting tx hash and confirmation status.
        String headerValue = PaymentResponseHeader.fromSettle(settle).encode();
        response.setHeader(HDR_PAYMENT_RESPONSE, headerValue);
        appendExposedHeader(response, HDR_PAYMENT_RESPONSE);
    }

    /* ------------------------------------------------------------------ */
    /* helpers                                                              */
    /* ------------------------------------------------------------------ */

    /**
     * Compose a 402 challenge body for the given route.
     *
     * @param request inbound request (used to populate {@link ResourceInfo#url})
     * @param route the matched route
     * @param error error code or human-readable message
     * @return the V2 PaymentRequired response body
     */
    static CardanoPaymentRequired buildChallenge(
            HttpServletRequest request, RouteConfig route, String error) {
        CardanoPaymentRequired body = new CardanoPaymentRequired();
        body.error = error;
        body.resource = new ResourceInfo(
                request.getRequestURL().toString(), route.description, route.mimeType);
        body.accepts.add(route.accepts);
        return body;
    }

    /** Convert a public {@link CardanoAccepts} into facilitator-shaped requirements. */
    static CardanoPaymentRequirements toRequirements(CardanoAccepts a) {
        CardanoPaymentRequirements r = new CardanoPaymentRequirements();
        r.scheme = a.scheme;
        r.network = a.network;
        r.asset = a.asset;
        r.amount = a.amount;
        r.payTo = a.payTo;
        r.maxTimeoutSeconds = a.maxTimeoutSeconds;
        r.extra = new HashMap<>(a.extra);
        return r;
    }

    private void respondWithChallenge(
            HttpServletRequest request,
            HttpServletResponse response,
            RouteConfig route,
            String error)
            throws IOException {
        CardanoPaymentRequired body = buildChallenge(request, route, error);
        String json = Json.MAPPER.writeValueAsString(body);

        response.setStatus(HttpServletResponse.SC_PAYMENT_REQUIRED);
        response.setContentType("application/json");
        // Echo the same body in the PAYMENT-REQUIRED header so SPAs that
        // can't read the body (e.g. opaque CORS responses) can still show
        // the challenge to the user.
        String b64 = Base64.getEncoder().encodeToString(json.getBytes(StandardCharsets.UTF_8));
        response.setHeader(HDR_PAYMENT_REQUIRED, b64);
        appendExposedHeader(response, HDR_PAYMENT_REQUIRED);

        try (PrintWriter out = response.getWriter()) {
            out.write(json);
        }
    }

    private void tryRespondAfterCommit(
            HttpServletResponse response, RouteConfig route, String error) {
        if (response.isCommitted()) {
            // Body already streamed; we cannot turn this into a 402. Best we
            // can do is set a PAYMENT-RESPONSE header reporting the failure
            // for clients that look at headers.
            try {
                PaymentResponseHeader h = new PaymentResponseHeader();
                h.success = false;
                h.network = route.accepts.network;
                response.setHeader(HDR_PAYMENT_RESPONSE, h.encode());
                appendExposedHeader(response, HDR_PAYMENT_RESPONSE);
            } catch (RuntimeException ignore) {
                // Already-committed response; nothing more to do.
            }
            return;
        }
        try {
            // Reset body and write a fresh 402 challenge.
            response.reset();
            CardanoPaymentRequired body = new CardanoPaymentRequired();
            body.error = error;
            body.accepts.add(route.accepts);
            String json = Json.MAPPER.writeValueAsString(body);
            response.setStatus(HttpServletResponse.SC_PAYMENT_REQUIRED);
            response.setContentType("application/json");
            String b64 =
                    Base64.getEncoder()
                            .encodeToString(json.getBytes(StandardCharsets.UTF_8));
            response.setHeader(HDR_PAYMENT_REQUIRED, b64);
            appendExposedHeader(response, HDR_PAYMENT_REQUIRED);
            try (PrintWriter out = response.getWriter()) {
                out.write(json);
            }
        } catch (IOException | RuntimeException ignore) {
            // Final fallback: just set the status code if writes fail.
            response.setStatus(HttpServletResponse.SC_PAYMENT_REQUIRED);
        }
    }

    private void writeServerError(HttpServletResponse response, String message)
            throws IOException {
        response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
        response.setContentType("application/json");
        try (PrintWriter out = response.getWriter()) {
            out.write("{\"error\":\"" + escapeJsonString(message) + "\"}");
        }
    }

    /** Append a header to {@code Access-Control-Expose-Headers} without clobbering existing values. */
    private static void appendExposedHeader(HttpServletResponse response, String headerName) {
        String existing = response.getHeader("Access-Control-Expose-Headers");
        if (existing == null || existing.isEmpty()) {
            response.setHeader("Access-Control-Expose-Headers", headerName);
            return;
        }
        // Avoid duplicates.
        for (String token : existing.split(",")) {
            if (token.trim().equalsIgnoreCase(headerName)) {
                return;
            }
        }
        response.setHeader("Access-Control-Expose-Headers", existing + ", " + headerName);
    }

    /** Minimal JSON-string escape suitable for the small error path above. */
    private static String escapeJsonString(String s) {
        if (s == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder(s.length() + 8);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
                }
            }
        }
        return sb.toString();
    }
}
