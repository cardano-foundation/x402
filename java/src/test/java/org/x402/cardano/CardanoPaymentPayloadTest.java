package org.x402.cardano;

import org.junit.jupiter.api.Test;
import org.x402.util.Json;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class CardanoPaymentPayloadTest {

    private static CardanoPaymentPayload sample() {
        CardanoPaymentPayload p = new CardanoPaymentPayload();
        Map<String, Object> inner = new HashMap<>();
        inner.put("transaction", "hKQA2QECgoJYIHCLvww0YzOj");
        inner.put(
                "nonce",
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

    @Test
    void roundTripsThroughBase64Header() {
        CardanoPaymentPayload original = sample();
        String header = original.encodeHeader();
        CardanoPaymentPayload decoded = CardanoPaymentPayload.fromHeader(header);
        assertEquals(2, decoded.x402Version);
        assertEquals(original.payload.get("nonce"), decoded.payload.get("nonce"));
        assertEquals(original.accepted.network, decoded.accepted.network);
        assertEquals(original.accepted.amount, decoded.accepted.amount);
        assertEquals(original.accepted.asset, decoded.accepted.asset);
    }

    @Test
    void rejectsEmptyHeader() {
        assertThrows(
                IllegalArgumentException.class, () -> CardanoPaymentPayload.fromHeader(""));
        assertThrows(
                IllegalArgumentException.class, () -> CardanoPaymentPayload.fromHeader(null));
    }

    @Test
    void rejectsMalformedBase64() {
        assertThrows(
                IllegalArgumentException.class,
                () -> CardanoPaymentPayload.fromHeader("not!base64!@@"));
    }

    @Test
    void getCardanoPayloadExtractsTypedFields() {
        CardanoPaymentPayload p = sample();
        ExactCardanoPayload typed = p.getCardanoPayload();
        assertEquals("hKQA2QECgoJYIHCLvww0YzOj", typed.transaction);
        assertEquals(
                "708bbf0c346333a3503b216a4d093b693aa295d302c6af464ecd6a976159a45b#3",
                typed.nonce);
    }

    @Test
    void getCardanoPayloadRejectsMissingFields() {
        CardanoPaymentPayload p = new CardanoPaymentPayload();
        p.payload = new HashMap<>();
        assertThrows(IllegalArgumentException.class, p::getCardanoPayload);
    }

    @Test
    void wireFormatStaysCamelCaseAndOmitsNullFields() throws Exception {
        CardanoPaymentRequirements r =
                CardanoPaymentRequirements.forDefaultTransfer(
                        "cardano:preprod", "lovelace", "5000000", "addr_test1qx");
        String json = Json.MAPPER.writeValueAsString(r);
        // Camel-cased on the wire; flat amount + asset (not nested).
        assert json.contains("\"network\":\"cardano:preprod\"");
        assert json.contains("\"amount\":\"5000000\"");
        assert json.contains("\"asset\":\"lovelace\"");
        assert json.contains("\"payTo\":\"addr_test1qx\"");
        assert json.contains("\"maxTimeoutSeconds\":300");
        assert json.contains("\"assetTransferMethod\":\"default\"");
    }
}
