package org.x402.cardano;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;
import org.x402.util.Json;

import java.io.ByteArrayOutputStream;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CardanoPaymentFilterTest {

    @Mock HttpServletRequest req;
    @Mock HttpServletResponse resp;
    @Mock FilterChain chain;
    @Mock CardanoFacilitator facilitator;

    private CardanoPaymentFilter filter;
    private ByteArrayOutputStream body;
    private final Map<String, String> writtenHeaders = new HashMap<>();
    private final int[] writtenStatus = {200};

    @BeforeEach
    void init() throws Exception {
        MockitoAnnotations.openMocks(this);

        body = new ByteArrayOutputStream();
        when(resp.getWriter()).thenReturn(new PrintWriter(body, true));

        // Track headers + status set on the response.
        when(resp.getStatus()).thenAnswer(inv -> writtenStatus[0]);
        org.mockito.Mockito.doAnswer(
                        inv -> {
                            writtenStatus[0] = inv.getArgument(0);
                            return null;
                        })
                .when(resp).setStatus(org.mockito.ArgumentMatchers.anyInt());
        org.mockito.Mockito.doAnswer(
                        inv -> {
                            writtenHeaders.put(inv.getArgument(0), inv.getArgument(1));
                            return null;
                        })
                .when(resp).setHeader(anyString(), anyString());
        when(resp.getHeader(anyString())).thenAnswer(inv -> writtenHeaders.get(inv.getArgument(0)));

        Map<String, RouteConfig> routes =
                Map.of(
                        "/premium",
                        RouteConfig.forDefault(
                                CardanoConstants.CARDANO_PREPROD,
                                "addr_test1qxpaytotest",
                                "5000000",
                                CardanoConstants.LOVELACE_ASSET,
                                "Cardano premium endpoint",
                                "application/json"));
        filter = new CardanoPaymentFilter(facilitator, routes);
    }

    /* ---------- free path passes through unchanged ---------- */
    @Test
    void freePathPassesThrough() throws Exception {
        when(req.getRequestURI()).thenReturn("/healthz");
        filter.doFilter(req, resp, chain);
        verify(chain).doFilter(req, resp);
        verify(resp, never()).setStatus(org.mockito.ArgumentMatchers.anyInt());
    }

    /* ---------- OPTIONS preflight always passes through ---------- */
    @Test
    void optionsPassesThroughEvenForProtectedRoute() throws Exception {
        when(req.getMethod()).thenReturn("OPTIONS");
        when(req.getRequestURI()).thenReturn("/premium");
        filter.doFilter(req, resp, chain);
        verify(chain).doFilter(req, resp);
    }

    /* ---------- missing PAYMENT-SIGNATURE returns 402 with challenge ---------- */
    @Test
    void missingHeaderRespondsWith402ChallengeAndExposesHeader() throws Exception {
        when(req.getMethod()).thenReturn("GET");
        when(req.getRequestURI()).thenReturn("/premium");
        when(req.getRequestURL())
                .thenReturn(new StringBuffer("http://localhost:8003/premium"));
        when(req.getHeader(CardanoPaymentFilter.HDR_PAYMENT_SIGNATURE)).thenReturn(null);

        filter.doFilter(req, resp, chain);

        assertEquals(HttpServletResponse.SC_PAYMENT_REQUIRED, writtenStatus[0]);
        verify(chain, never()).doFilter(any(), any());

        // Body is the JSON challenge.
        JsonNode challenge = Json.MAPPER.readTree(body.toString(StandardCharsets.UTF_8));
        assertEquals(2, challenge.get("x402Version").asInt());
        assertEquals(CardanoConstants.CARDANO_PREPROD,
                challenge.get("accepts").get(0).get("network").asText());
        assertEquals(CardanoConstants.LOVELACE_ASSET,
                challenge.get("accepts").get(0).get("asset").asText());
        assertEquals("5000000",
                challenge.get("accepts").get(0).get("amount").asText());
        assertEquals("addr_test1qxpaytotest",
                challenge.get("accepts").get(0).get("payTo").asText());

        // PAYMENT-REQUIRED header is base64 of the same JSON.
        String hdrB64 = writtenHeaders.get(CardanoPaymentFilter.HDR_PAYMENT_REQUIRED);
        assertNotNull(hdrB64, "PAYMENT-REQUIRED header should be set");
        String decodedHdr = new String(Base64.getDecoder().decode(hdrB64), StandardCharsets.UTF_8);
        assertEquals(challenge, Json.MAPPER.readTree(decodedHdr));

        // CORS exposed list includes PAYMENT-REQUIRED.
        String exposed = writtenHeaders.get("Access-Control-Expose-Headers");
        assertNotNull(exposed);
        assertTrue(exposed.contains(CardanoPaymentFilter.HDR_PAYMENT_REQUIRED));
    }

    /* ---------- malformed PAYMENT-SIGNATURE returns 402 with invalid_payload ---------- */
    @Test
    void malformedHeaderReturnsInvalidPayloadCode() throws Exception {
        when(req.getMethod()).thenReturn("GET");
        when(req.getRequestURI()).thenReturn("/premium");
        when(req.getRequestURL())
                .thenReturn(new StringBuffer("http://localhost:8003/premium"));
        when(req.getHeader(CardanoPaymentFilter.HDR_PAYMENT_SIGNATURE))
                .thenReturn("not_valid_base64_$%^");

        filter.doFilter(req, resp, chain);

        assertEquals(HttpServletResponse.SC_PAYMENT_REQUIRED, writtenStatus[0]);
        JsonNode challenge = Json.MAPPER.readTree(body.toString(StandardCharsets.UTF_8));
        assertEquals(CardanoConstants.ERR_INVALID_PAYLOAD, challenge.get("error").asText());
    }

    /* ---------- facilitator says invalid → 402 with the facilitator's reason ---------- */
    @Test
    void verifyInvalidReasonIsBubbledTo402() throws Exception {
        when(req.getMethod()).thenReturn("GET");
        when(req.getRequestURI()).thenReturn("/premium");
        when(req.getRequestURL())
                .thenReturn(new StringBuffer("http://localhost:8003/premium"));

        String header = makeValidPaymentSignatureHeader();
        when(req.getHeader(CardanoPaymentFilter.HDR_PAYMENT_SIGNATURE)).thenReturn(header);

        CardanoVerifyResponse vr = new CardanoVerifyResponse();
        vr.isValid = false;
        vr.invalidReason = CardanoConstants.ERR_NONCE_NOT_ON_CHAIN;
        when(facilitator.verify(any(), any())).thenReturn(vr);

        filter.doFilter(req, resp, chain);

        assertEquals(HttpServletResponse.SC_PAYMENT_REQUIRED, writtenStatus[0]);
        JsonNode challenge = Json.MAPPER.readTree(body.toString(StandardCharsets.UTF_8));
        assertEquals(CardanoConstants.ERR_NONCE_NOT_ON_CHAIN, challenge.get("error").asText());
        verify(chain, never()).doFilter(any(), any());
    }

    /* ---------- happy path: verify ok → handler runs → settle ok → PAYMENT-RESPONSE ---------- */
    @Test
    void happyPathSetsPaymentResponseHeader() throws Exception {
        when(req.getMethod()).thenReturn("GET");
        when(req.getRequestURI()).thenReturn("/premium");
        when(req.getRequestURL())
                .thenReturn(new StringBuffer("http://localhost:8003/premium"));

        String header = makeValidPaymentSignatureHeader();
        when(req.getHeader(CardanoPaymentFilter.HDR_PAYMENT_SIGNATURE)).thenReturn(header);

        CardanoVerifyResponse vr = new CardanoVerifyResponse();
        vr.isValid = true;
        vr.payer = "addr_test1qpayer";
        when(facilitator.verify(any(), any())).thenReturn(vr);

        CardanoSettleResponse sr = new CardanoSettleResponse();
        sr.success = true;
        sr.payer = "addr_test1qpayer";
        sr.transaction = "abc123";
        sr.network = CardanoConstants.CARDANO_PREPROD;
        sr.extensions = Map.of("status", "confirmed");
        when(facilitator.settle(any(), any())).thenReturn(sr);

        filter.doFilter(req, resp, chain);

        verify(chain).doFilter(req, resp);

        String responseHeader = writtenHeaders.get(CardanoPaymentFilter.HDR_PAYMENT_RESPONSE);
        assertNotNull(responseHeader);
        String decoded = new String(Base64.getDecoder().decode(responseHeader), StandardCharsets.UTF_8);
        JsonNode payload = Json.MAPPER.readTree(decoded);
        assertTrue(payload.get("success").asBoolean());
        assertEquals("abc123", payload.get("transaction").asText());
        assertEquals(CardanoConstants.CARDANO_PREPROD, payload.get("network").asText());
        assertEquals("confirmed", payload.get("extensions").get("status").asText());
    }

    /* ---------- handler returned ≥400: settlement is skipped ---------- */
    @Test
    void doesNotSettleWhenDownstreamHandlerErrors() throws Exception {
        when(req.getMethod()).thenReturn("GET");
        when(req.getRequestURI()).thenReturn("/premium");
        when(req.getRequestURL())
                .thenReturn(new StringBuffer("http://localhost:8003/premium"));

        String header = makeValidPaymentSignatureHeader();
        when(req.getHeader(CardanoPaymentFilter.HDR_PAYMENT_SIGNATURE)).thenReturn(header);

        CardanoVerifyResponse vr = new CardanoVerifyResponse();
        vr.isValid = true;
        when(facilitator.verify(any(), any())).thenReturn(vr);

        // Simulate downstream returning 500.
        org.mockito.Mockito.doAnswer(
                        inv -> {
                            writtenStatus[0] = 500;
                            return null;
                        })
                .when(chain).doFilter(any(), any());

        filter.doFilter(req, resp, chain);
        verify(facilitator, never()).settle(any(), any());
    }

    private static String makeValidPaymentSignatureHeader() {
        CardanoPaymentPayload p = new CardanoPaymentPayload();
        Map<String, Object> inner = new HashMap<>();
        inner.put("transaction", "hKQA2QEC");
        inner.put(
                "nonce",
                "708bbf0c346333a3503b216a4d093b693aa295d302c6af464ecd6a976159a45b#3");
        p.payload = inner;
        p.accepted =
                CardanoPaymentRequirements.forDefaultTransfer(
                        CardanoConstants.CARDANO_PREPROD,
                        CardanoConstants.LOVELACE_ASSET,
                        "5000000",
                        "addr_test1qxpaytotest");
        return p.encodeHeader();
    }
}
