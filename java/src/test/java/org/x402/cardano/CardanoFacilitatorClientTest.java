package org.x402.cardano;

import com.github.tomakehurst.wiremock.WireMockServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.equalTo;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.matchingJsonPath;
import static com.github.tomakehurst.wiremock.client.WireMock.post;
import static com.github.tomakehurst.wiremock.client.WireMock.postRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.urlEqualTo;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CardanoFacilitatorClientTest {

    static WireMockServer wm;
    CardanoFacilitatorClient client;

    @BeforeAll
    static void start() {
        wm = new WireMockServer(0);
        wm.start();
    }

    @AfterAll
    static void stop() {
        wm.stop();
    }

    @BeforeEach
    void setUp() {
        wm.resetAll();
        client = new CardanoFacilitatorClient("http://localhost:" + wm.port());
    }

    @Test
    void trailingSlashIsTrimmed() {
        CardanoFacilitatorClient withSlash =
                new CardanoFacilitatorClient("http://localhost:" + wm.port() + "/");
        wm.stubFor(
                get(urlEqualTo("/supported"))
                        .willReturn(
                                aResponse()
                                        .withHeader("Content-Type", "application/json")
                                        .withBody("{\"kinds\":[]}")));
        assertDoesNotThrow(withSlash::supported);
    }

    @Test
    void verifyHappyPath() throws Exception {
        wm.stubFor(
                post(urlEqualTo("/verify"))
                        .willReturn(
                                aResponse()
                                        .withHeader("Content-Type", "application/json")
                                        .withBody(
                                                "{\"isValid\":true,\"payer\":\"addr_test1q...\"}")));

        CardanoVerifyResponse vr = client.verify(samplePayload(), sampleRequirements());
        assertTrue(vr.isValid);
        assertEquals("addr_test1q...", vr.payer);

        // Verify the envelope has x402Version=2 and the requirements are passed through.
        wm.verify(
                postRequestedFor(urlEqualTo("/verify"))
                        .withRequestBody(matchingJsonPath("$.x402Version", equalTo("2")))
                        .withRequestBody(
                                matchingJsonPath(
                                        "$.paymentRequirements.network",
                                        equalTo("cardano:preprod"))));
    }

    @Test
    void verifyParsesSnakeCaseAliasesFromPython() throws Exception {
        wm.stubFor(
                post(urlEqualTo("/verify"))
                        .willReturn(
                                aResponse()
                                        .withHeader("Content-Type", "application/json")
                                        .withBody(
                                                "{\"is_valid\":false,"
                                                        + "\"invalid_reason\":\"exact_cardano_facilitator_chain_lookup_failed\","
                                                        + "\"invalid_message\":\"Blockfrost timed out\"}")));

        CardanoVerifyResponse vr = client.verify(samplePayload(), sampleRequirements());
        assertFalse(vr.isValid);
        assertEquals(
                CardanoConstants.ERR_CHAIN_LOOKUP_FAILED, vr.invalidReason);
        assertEquals("Blockfrost timed out", vr.invalidMessage);
    }

    @Test
    void settleHappyPath() throws Exception {
        wm.stubFor(
                post(urlEqualTo("/settle"))
                        .willReturn(
                                aResponse()
                                        .withHeader("Content-Type", "application/json")
                                        .withBody(
                                                "{\"success\":true,"
                                                        + "\"transaction\":\"abcd1234\","
                                                        + "\"network\":\"cardano:preprod\","
                                                        + "\"payer\":\"addr_test1q...\","
                                                        + "\"extensions\":{\"status\":\"confirmed\"}}")));
        CardanoSettleResponse sr = client.settle(samplePayload(), sampleRequirements());
        assertTrue(sr.success);
        assertEquals("abcd1234", sr.transaction);
        assertEquals("cardano:preprod", sr.network);
        assertEquals("confirmed", sr.extensions.get("status"));
    }

    @Test
    void verifyThrowsOnNon200() {
        wm.stubFor(post(urlEqualTo("/verify")).willReturn(aResponse().withStatus(503)));
        assertThrows(
                IOException.class, () -> client.verify(samplePayload(), sampleRequirements()));
    }

    private static CardanoPaymentPayload samplePayload() {
        CardanoPaymentPayload p = new CardanoPaymentPayload();
        Map<String, Object> inner = new HashMap<>();
        inner.put("transaction", "hKQA2QEC");
        inner.put("nonce",
                "708bbf0c346333a3503b216a4d093b693aa295d302c6af464ecd6a976159a45b#3");
        p.payload = inner;
        p.accepted =
                CardanoPaymentRequirements.forDefaultTransfer(
                        CardanoConstants.CARDANO_PREPROD,
                        CardanoConstants.LOVELACE_ASSET,
                        "5000000",
                        "addr_test1qx");
        return p;
    }

    private static CardanoPaymentRequirements sampleRequirements() {
        return CardanoPaymentRequirements.forDefaultTransfer(
                CardanoConstants.CARDANO_PREPROD,
                CardanoConstants.LOVELACE_ASSET,
                "5000000",
                "addr_test1qx");
    }
}
