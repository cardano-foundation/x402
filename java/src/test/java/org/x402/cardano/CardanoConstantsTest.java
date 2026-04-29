package org.x402.cardano;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CardanoConstantsTest {

    @Test
    void networkIdResolvesMainnetAndTestnets() {
        assertEquals(
                CardanoConstants.CARDANO_NETWORK_ID_MAINNET,
                CardanoConstants.getNetworkId(CardanoConstants.CARDANO_MAINNET));
        assertEquals(
                CardanoConstants.CARDANO_NETWORK_ID_TESTNET,
                CardanoConstants.getNetworkId(CardanoConstants.CARDANO_PREPROD));
        assertEquals(
                CardanoConstants.CARDANO_NETWORK_ID_TESTNET,
                CardanoConstants.getNetworkId(CardanoConstants.CARDANO_PREVIEW));
    }

    @Test
    void networkIdRejectsUnknown() {
        assertThrows(
                IllegalArgumentException.class,
                () -> CardanoConstants.getNetworkId("eip155:8453"));
    }

    @Test
    void isCardanoNetworkRecognisesAllThree() {
        assertTrue(CardanoConstants.isCardanoNetwork("cardano:mainnet"));
        assertTrue(CardanoConstants.isCardanoNetwork("cardano:preprod"));
        assertTrue(CardanoConstants.isCardanoNetwork("cardano:preview"));
        assertFalse(CardanoConstants.isCardanoNetwork("solana:mainnet"));
        assertFalse(CardanoConstants.isCardanoNetwork(null));
    }

    @Test
    void assetRegexAcceptsLovelaceAndPolicyAssetPair() {
        assertTrue("lovelace".matches(CardanoConstants.CARDANO_ASSET_REGEX));
        // 56 hex chars policy id + dot + asset name hex
        String policy = "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad";
        assertTrue((policy + ".0014df105553444d").matches(CardanoConstants.CARDANO_ASSET_REGEX));
        assertFalse("LOVELACE".matches(CardanoConstants.CARDANO_ASSET_REGEX));
        assertFalse("0xtoken".matches(CardanoConstants.CARDANO_ASSET_REGEX));
    }

    @Test
    void utxoRefRegexShape() {
        String txhash = "708bbf0c346333a3503b216a4d093b693aa295d302c6af464ecd6a976159a45b";
        assertTrue((txhash + "#3").matches(CardanoConstants.CARDANO_UTXO_REF_REGEX));
        assertFalse((txhash).matches(CardanoConstants.CARDANO_UTXO_REF_REGEX));
        assertFalse(("xy" + "#0").matches(CardanoConstants.CARDANO_UTXO_REF_REGEX));
    }
}
