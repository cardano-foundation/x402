package org.x402.mechanisms.cardano.chain;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.equalTo;
import static com.github.tomakehurst.wiremock.client.WireMock.equalToJson;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.getRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.okJson;
import static com.github.tomakehurst.wiremock.client.WireMock.post;
import static com.github.tomakehurst.wiremock.client.WireMock.postRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.urlEqualTo;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.bloxbean.cardano.client.api.model.ProtocolParams;
import com.github.tomakehurst.wiremock.junit5.WireMockExtension;
import java.math.BigInteger;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.x402.mechanisms.cardano.CardanoTransactionDecoder;
import org.x402.mechanisms.cardano.testing.Ccl;
import org.x402.mechanisms.cardano.testing.Vectors;

/** The Blockfrost backend against a WireMock Blockfrost: every SPI method, incl. evidence. */
class BlockfrostChainBackendTest {

  @RegisterExtension
  static WireMockExtension wm = WireMockExtension.newInstance().options(wireMockConfig().dynamicPort()).build();

  private static final String TX = "ab".repeat(32);
  private static final String PAYER =
      Vectors.fixture("01-default-happy").get("expected").get("payer").asText();
  private static final String UNIT = "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9" + "0014df10745553444d";
  private static final Clock CLOCK = Clock.fixed(Instant.ofEpochMilli(1_655_769_600_000L + 1_000_000L), ZoneOffset.UTC);

  private static BlockfrostChainBackend backend(boolean awaitConfirmation) {
    return new BlockfrostChainBackend(
        BlockfrostChainBackend.Config.builder()
            .network("cardano:preprod")
            .baseUrl(wm.baseUrl() + "/")
            .projectId("preprodKey")
            .requestTimeout(Duration.ofSeconds(2))
            .awaitConfirmation(awaitConfirmation)
            .confirmationPoll(Duration.ofMillis(5))
            .clock(CLOCK)
            .build());
  }

  private static String utxos(String consumedBy) {
    return "{\"hash\":\"" + TX + "\",\"inputs\":[],\"outputs\":[{\"output_index\":0,\"address\":\""
        + PAYER + "\",\"amount\":[{\"unit\":\"lovelace\",\"quantity\":\"5000000\"},{\"unit\":\"" + UNIT
        + "\",\"quantity\":\"7\"}],\"consumed_by_tx\":" + consumedBy + "}]}";
  }

  @Test
  void anUnspentOutputReportsOwnerValueAndKeyHash() {
    wm.stubFor(get("/txs/" + TX + "/utxos").withHeader("project_id", equalTo("preprodKey")).willReturn(okJson(utxos("null"))));

    UtxoSnapshot snapshot = backend(false).getUtxo(TX + "#0", "cardano:preprod");

    assertThat(snapshot.exists()).isTrue();
    assertThat(snapshot.address()).isEqualTo(PAYER);
    assertThat(snapshot.coin()).isEqualTo(BigInteger.valueOf(5_000_000));
    assertThat(snapshot.assets())
        .containsExactly(Map.entry("e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9.0014df10745553444d", BigInteger.valueOf(7)));
    assertThat(snapshot.paymentKeyHash()).hasSize(56);
  }

  @Test
  void aConsumedOutputIsSpentButKeepsItsOwner() {
    wm.stubFor(get("/txs/" + TX + "/utxos").willReturn(okJson(utxos("\"" + "cd".repeat(32) + "\""))));

    UtxoSnapshot snapshot = backend(false).getUtxo(TX + "#0", "cardano:preprod");

    assertThat(snapshot.exists()).isFalse();
    assertThat(snapshot.address()).isEqualTo(PAYER);
  }

  @Test
  void anUnknownTransactionOrIndexDoesNotExist() {
    wm.stubFor(get("/txs/" + TX + "/utxos").willReturn(aResponse().withStatus(404)));
    assertThat(backend(false).getUtxo(TX + "#0", "cardano:preprod").exists()).isFalse();

    wm.stubFor(get("/txs/" + "cd".repeat(32) + "/utxos").willReturn(okJson(utxos("null"))));
    UtxoSnapshot missingIndex = backend(false).getUtxo("cd".repeat(32) + "#3", "cardano:preprod");
    assertThat(missingIndex.exists()).isFalse();
    assertThat(missingIndex.address()).isNull();
  }

  @Test
  void providerFailuresThrow() {
    wm.stubFor(get("/txs/" + TX + "/utxos").willReturn(aResponse().withStatus(500).withBody("boom")));
    assertThatThrownBy(() -> backend(false).getUtxo(TX + "#0", "cardano:preprod"))
        .isInstanceOf(ChainLookupException.class)
        .hasMessageContaining("500");
    assertThatThrownBy(() -> backend(false).getUtxo(TX + "#0", "cardano:mainnet"))
        .hasMessage("Backend configured for cardano:preprod but asked about cardano:mainnet");
  }

  @Test
  void theCurrentSlotComesFromTheClock() {
    assertThat(backend(false).getCurrentSlot("cardano:preprod")).isEqualTo(86_400L + 1_000L);
  }

  @Test
  void protocolParametersAreReadLiveAndCached() {
    wm.stubFor(
        get("/epochs/latest/parameters")
            .willReturn(okJson("{\"coins_per_utxo_size\":\"4310\",\"min_fee_a\":44,\"min_fee_b\":155381}")));
    BlockfrostChainBackend backend = backend(false);

    ProtocolParams first = backend.getProtocolParameters("cardano:preprod");
    ProtocolParams second = backend.getProtocolParameters("cardano:preprod");

    assertThat(first)
        .isEqualTo(Ccl.params(BigInteger.valueOf(4310), BigInteger.valueOf(44), BigInteger.valueOf(155381)));
    assertThat(second).isEqualTo(first);
    wm.verify(1, getRequestedFor(urlEqualTo("/epochs/latest/parameters")));
  }

  @Test
  void submitPostsTheExactBytesAndReportsMempool() {
    String tx = Vectors.fixture("01-default-happy").get("payload").get("payload").get("transaction").asText();
    String hash = CardanoTransactionDecoder.decode(tx).txHash();
    wm.stubFor(post("/tx/submit").willReturn(okJson("\"" + hash + "\"")));

    SubmissionResult result = backend(false).submitTransaction(tx, "cardano:preprod");

    assertThat(result.txHash()).isEqualTo(hash);
    assertThat(result.status()).isEqualTo(SettlementEvidence.Status.MEMPOOL);
    wm.verify(
        postRequestedFor(urlEqualTo("/tx/submit"))
            .withHeader("Content-Type", equalTo("application/cbor"))
            .withRequestBody(com.github.tomakehurst.wiremock.client.WireMock.binaryEqualTo(Base64.getDecoder().decode(tx))));
  }

  @Test
  void submitAwaitsInclusionWhenAsked() {
    String tx = Vectors.fixture("01-default-happy").get("payload").get("payload").get("transaction").asText();
    String hash = CardanoTransactionDecoder.decode(tx).txHash();
    wm.stubFor(post("/tx/submit").willReturn(okJson("\"" + hash + "\"")));
    wm.stubFor(get("/txs/" + hash).willReturn(okJson("{\"hash\":\"" + hash + "\",\"block_height\":10}")));

    assertThat(backend(true).submitTransaction(tx, "cardano:preprod").status())
        .isEqualTo(SettlementEvidence.Status.CONFIRMED);
  }

  @Test
  void aRejectedSubmissionThrowsWithTheNodeReason() {
    String tx = Vectors.fixture("01-default-happy").get("payload").get("payload").get("transaction").asText();
    wm.stubFor(post("/tx/submit").willReturn(aResponse().withStatus(400).withBody("{\"message\":\"BadInputsUTxO\"}")));

    assertThatThrownBy(() -> backend(false).submitTransaction(tx, "cardano:preprod"))
        .hasMessageContaining("BadInputsUTxO");
    assertThat(backend(false).isDefinitiveSubmissionRejection(new RuntimeException("x"))).isFalse();
  }

  @Test
  void evidenceReportsCanonicalDepth() {
    BlockfrostChainBackend backend = backend(false);
    assertThat(backend.supportsTransactionEvidence()).isTrue();

    wm.stubFor(get("/txs/" + TX).willReturn(aResponse().withStatus(404)));
    assertThat(backend.getTransactionEvidence(TX, "cardano:preprod")).isEqualTo(SettlementEvidence.unknown());

    wm.stubFor(get("/txs/" + TX).willReturn(okJson("{\"hash\":\"" + TX + "\",\"block_height\":100}")));
    wm.stubFor(get("/blocks/latest").willReturn(okJson("{\"height\":103}")));
    assertThat(backend.getTransactionEvidence(TX, "cardano:preprod"))
        .isEqualTo(new SettlementEvidence(SettlementEvidence.Status.CONFIRMED, 3));

    wm.stubFor(get("/txs/" + TX).willReturn(okJson("{\"hash\":\"" + TX + "\",\"block_height\":100,\"valid_contract\":false}")));
    assertThat(backend.getTransactionEvidence(TX, "cardano:preprod")).isEqualTo(SettlementEvidence.unknown());
  }

  @Test
  void evaluationUsesTheJsonEndpointAndFailsOnScriptFailure() {
    String tx = Vectors.fixture("01-default-happy").get("payload").get("payload").get("transaction").asText();
    String cborHex = HexFormat.of().formatHex(Base64.getDecoder().decode(tx));
    wm.stubFor(
        post(urlPathEqualTo("/utils/txs/evaluate/utxos"))
            .withRequestBody(equalToJson("{\"cbor\":\"" + cborHex + "\",\"additionalUtxoSet\":[]}"))
            .willReturn(okJson("{\"type\":\"jsonwsp/response\",\"result\":{\"EvaluationResult\":{}}}")));
    backend(false).evaluateTransaction(tx, "cardano:preprod");

    wm.stubFor(
        post(urlPathEqualTo("/utils/txs/evaluate/utxos"))
            .willReturn(okJson("{\"type\":\"jsonwsp/response\",\"result\":{\"EvaluationFailure\":{\"x\":1}}}")));
    assertThatThrownBy(() -> backend(false).evaluateTransaction(tx, "cardano:preprod"))
        .hasMessageContaining("script evaluation failed");

    wm.stubFor(
        post(urlPathEqualTo("/utils/txs/evaluate/utxos"))
            .willReturn(okJson("{\"type\":\"jsonwsp/fault\",\"fault\":{\"string\":\"bad\"}}")));
    assertThatThrownBy(() -> backend(false).evaluateTransaction(tx, "cardano:preprod"))
        .hasMessageContaining("evaluation fault: bad");
  }

  @Test
  void knowsTheBlockfrostUrlOfEachNetwork() {
    assertThat(BlockfrostChainBackend.defaultBaseUrl("cardano:mainnet"))
        .isEqualTo("https://cardano-mainnet.blockfrost.io/api/v0");
    assertThat(BlockfrostChainBackend.defaultBaseUrl("cardano:preprod"))
        .isEqualTo("https://cardano-preprod.blockfrost.io/api/v0");
    assertThat(BlockfrostChainBackend.defaultBaseUrl("cardano:preview"))
        .isEqualTo("https://cardano-preview.blockfrost.io/api/v0");
  }

  @Test
  void anOutputIndexPast32BitsNeverMatchesIndexZero() {
    wm.stubFor(get("/txs/" + TX + "/utxos").willReturn(okJson(utxos("null"))));

    assertThat(backend(false).getUtxo(TX + "#4294967296", "cardano:preprod").exists()).isFalse();
  }

  @Test
  void anOutputIndexPast32BitsNeverMatchesIndexZeroOnTheAddressScan() {
    wm.stubFor(get("/txs/" + TX + "/utxos").willReturn(okJson(
        "{\"hash\":\"" + TX + "\",\"inputs\":[],\"outputs\":[{\"output_index\":0,\"address\":\""
            + PAYER + "\",\"amount\":[{\"unit\":\"lovelace\",\"quantity\":\"5000000\"}]}]}")));
    wm.stubFor(get(urlPathEqualTo("/addresses/" + PAYER + "/utxos")).willReturn(okJson(
        "[{\"tx_hash\":\"" + TX + "\",\"output_index\":0,\"amount\":[]}]")));

    assertThat(backend(false).getUtxo(TX + "#4294967296", "cardano:preprod").exists()).isFalse();
  }

  @Test
  void aFailedWalletPageIsALookupFailureNotAShortList() {
    StringBuilder full = new StringBuilder("[");
    for (int i = 0; i < 100; i++) {
      full.append(i == 0 ? "" : ",").append("{\"tx_hash\":\"").append(TX).append("\",\"output_index\":")
          .append(i).append(",\"amount\":[{\"unit\":\"lovelace\",\"quantity\":\"1000000\"}]}");
    }
    full.append("]");
    wm.stubFor(get(urlPathEqualTo("/addresses/" + PAYER + "/utxos")).withQueryParam("page", equalTo("1"))
        .willReturn(okJson(full.toString())));
    wm.stubFor(get(urlPathEqualTo("/addresses/" + PAYER + "/utxos")).withQueryParam("page", equalTo("2"))
        .willReturn(aResponse().withStatus(500).withBody("boom")));

    assertThatThrownBy(() -> backend(false).getAll(PAYER)).isInstanceOf(ChainLookupException.class);
  }

  @Test
  void aWalletPageThatIsNotAListIsALookupFailure() {
    wm.stubFor(get(urlPathEqualTo("/addresses/" + PAYER + "/utxos"))
        .willReturn(okJson("{\"error\":\"unexpected\"}")));

    assertThatThrownBy(() -> backend(false).getAll(PAYER)).isInstanceOf(ChainLookupException.class);
  }

  @Test
  void aUtxoAnswerWithoutOutputsIsALookupFailureNotSpent() {
    wm.stubFor(get("/txs/" + TX + "/utxos").willReturn(okJson("{\"hash\":\"" + TX + "\"}")));

    assertThatThrownBy(() -> backend(false).getUtxo(TX + "#0", "cardano:preprod"))
        .isInstanceOf(ChainLookupException.class);
  }

  @Test
  void aMatchingOutputWithoutAnAddressIsALookupFailureNotSpent() {
    wm.stubFor(get("/txs/" + TX + "/utxos").willReturn(okJson(
        "{\"hash\":\"" + TX + "\",\"outputs\":[{\"output_index\":0,\"amount\":[]}]}")));

    assertThatThrownBy(() -> backend(false).getUtxo(TX + "#0", "cardano:preprod"))
        .isInstanceOf(ChainLookupException.class);
  }

  @Test
  void anAddressScanPageThatIsNotAListIsALookupFailure() {
    wm.stubFor(get("/txs/" + TX + "/utxos").willReturn(okJson(
        "{\"hash\":\"" + TX + "\",\"outputs\":[{\"output_index\":0,\"address\":\""
            + PAYER + "\",\"amount\":[{\"unit\":\"lovelace\",\"quantity\":\"5000000\"}]}]}")));
    wm.stubFor(get(urlPathEqualTo("/addresses/" + PAYER + "/utxos")).willReturn(okJson("{}")));

    assertThatThrownBy(() -> backend(false).getUtxo(TX + "#0", "cardano:preprod"))
        .isInstanceOf(ChainLookupException.class);
  }

  @Test
  void anOversizedBlockHeightIsALookupFailure() {
    wm.stubFor(get("/txs/" + TX).willReturn(okJson(
        "{\"hash\":\"" + TX + "\",\"block_height\":18446744073709551616}")));
    wm.stubFor(get("/blocks/latest").willReturn(okJson("{\"height\":103}")));

    assertThatThrownBy(() -> backend(false).getTransactionEvidence(TX, "cardano:preprod"))
        .isInstanceOf(ChainLookupException.class);
  }

  @Test
  void evidenceForAnotherOrNoTransactionIsALookupFailure() {
    wm.stubFor(get("/blocks/latest").willReturn(okJson("{\"height\":103}")));
    for (String body : new String[] {"{\"block_height\":100}",
        "{\"hash\":\"" + "cd".repeat(32) + "\",\"block_height\":100}"}) {
      wm.stubFor(get("/txs/" + TX).willReturn(okJson(body)));
      assertThatThrownBy(() -> backend(false).getTransactionEvidence(TX, "cardano:preprod"))
          .as(body).isInstanceOf(ChainLookupException.class);
    }
  }

  @Test
  void aMissingTipIsALookupFailure() {
    wm.stubFor(get("/txs/" + TX).willReturn(okJson("{\"hash\":\"" + TX + "\",\"block_height\":100}")));
    wm.stubFor(get("/blocks/latest").willReturn(aResponse().withStatus(404)));

    assertThatThrownBy(() -> backend(false).getTransactionEvidence(TX, "cardano:preprod"))
        .isInstanceOf(ChainLookupException.class);
  }

  @Test
  void aMistypedConsumedByIsALookupFailureNotUnspent() {
    wm.stubFor(get("/txs/" + TX + "/utxos").willReturn(okJson(utxos("7"))));

    assertThatThrownBy(() -> backend(false).getUtxo(TX + "#0", "cardano:preprod"))
        .isInstanceOf(ChainLookupException.class);
  }

  @Test
  void malformedTransactionEvidenceIsALookupFailure() {
    wm.stubFor(get("/blocks/latest").willReturn(okJson("{\"height\":103}")));
    for (String body : new String[] {"null", "[]", "{\"hash\":\"" + TX + "\",\"block_height\":100,\"valid_contract\":\"false\"}"}) {
      wm.stubFor(get("/txs/" + TX).willReturn(okJson(body)));
      assertThatThrownBy(() -> backend(false).getTransactionEvidence(TX, "cardano:preprod"))
          .as(body).isInstanceOf(ChainLookupException.class);
    }
  }

  @Test
  void anEmptyConsumedByIsALookupFailureNotUnspent() {
    wm.stubFor(get("/txs/" + TX + "/utxos").willReturn(okJson(utxos("\"\""))));

    assertThatThrownBy(() -> backend(false).getUtxo(TX + "#0", "cardano:preprod"))
        .isInstanceOf(ChainLookupException.class);
  }

  @Test
  void anAddressScanRowWithoutAnIndexIsALookupFailureNotAMatch() {
    wm.stubFor(get("/txs/" + TX + "/utxos").willReturn(okJson(
        "{\"hash\":\"" + TX + "\",\"outputs\":[{\"output_index\":0,\"address\":\""
            + PAYER + "\",\"amount\":[{\"unit\":\"lovelace\",\"quantity\":\"5000000\"}]}]}")));
    wm.stubFor(get(urlPathEqualTo("/addresses/" + PAYER + "/utxos")).willReturn(okJson(
        "[{\"tx_hash\":\"" + TX + "\",\"amount\":[]}]")));

    assertThatThrownBy(() -> backend(false).getUtxo(TX + "#0", "cardano:preprod"))
        .isInstanceOf(ChainLookupException.class);
  }

  @Test
  void anOutputRowWithoutAnIndexIsALookupFailureNotSpent() {
    wm.stubFor(get("/txs/" + TX + "/utxos").willReturn(okJson(
        "{\"hash\":\"" + TX + "\",\"outputs\":[{\"address\":\"" + PAYER + "\",\"amount\":[]}]}")));

    assertThatThrownBy(() -> backend(false).getUtxo(TX + "#0", "cardano:preprod"))
        .isInstanceOf(ChainLookupException.class);
  }
}
