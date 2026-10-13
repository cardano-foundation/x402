package org.x402.mechanisms.cardano.chain;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.math.BigInteger;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import org.x402.core.json.X402Json;
import org.x402.mechanisms.cardano.CardanoAddresses;
import org.x402.mechanisms.cardano.CardanoNetworks;
import org.x402.mechanisms.cardano.CardanoUtils;

/**
 * {@link CardanoChainBackend} over the Blockfrost REST API, mirroring TS {@code
 * toFacilitatorCardanoSigner} with a Blockfrost provider ({@code signer.ts:862-1196}), including
 * the transaction-evidence read that lets the facilitator advertise and settle {@code
 * l1Confirmations} above 0. One instance serves one network. It also serves a buyer wallet
 * ({@link CardanoWalletProvider}). Thread-safe.
 */
public final class BlockfrostChainBackend implements CardanoChainBackend, CardanoWalletProvider {

  private static final long PROTOCOL_PARAMETERS_CACHE_MS = 10 * 60_000L;
  private static final int MAX_ADDRESS_PAGES = 50;

  private final Config config;
  private final String baseUrl;
  private final HttpClient http;
  private final Object cacheLock = new Object();
  private ProtocolParameters cachedParameters;
  private long cachedAt;

  /**
   * Backend settings.
   *
   * @param network the x402 Cardano network this backend serves
   * @param baseUrl Blockfrost base URL, e.g. {@code https://cardano-preprod.blockfrost.io/api/v0}
   * @param projectId Blockfrost project id, or {@code null} for a self-hosted instance
   * @param requestTimeout deadline per request (1 ms – 120 s, default 10 s, TS {@code
   *     requestTimeoutMs})
   * @param awaitConfirmation whether {@code submitTransaction} waits (up to the request timeout)
   *     for inclusion before answering, TS default {@code true}
   * @param confirmationPoll poll interval of that wait (Evolution default 5 s)
   * @param clock the clock for the current slot and the parameter cache
   */
  public record Config(
      String network,
      String baseUrl,
      String projectId,
      Duration requestTimeout,
      boolean awaitConfirmation,
      Duration confirmationPoll,
      Clock clock) {

    /** Validates and fills defaults. */
    public Config {
      if (!CardanoNetworks.isCardanoNetwork(network)) {
        throw new IllegalArgumentException("Unsupported Cardano network: " + network);
      }
      baseUrl = baseUrl == null ? defaultBaseUrl(network) : baseUrl;
      requestTimeout = requestTimeout == null ? Duration.ofSeconds(10) : requestTimeout;
      if (requestTimeout.isNegative()
          || requestTimeout.isZero()
          || requestTimeout.compareTo(Duration.ofSeconds(120)) > 0) {
        throw new IllegalArgumentException(
            "Cardano provider requestTimeout must be from 1 ms to 120 s");
      }
      confirmationPoll = confirmationPoll == null ? Duration.ofSeconds(5) : confirmationPoll;
      clock = clock == null ? Clock.systemUTC() : clock;
    }

    /**
     * A builder with the TS defaults.
     *
     * @return the builder
     */
    public static Builder builder() {
      return new Builder();
    }

    /** Builder for {@link Config}. */
    public static final class Builder {
      private String network;
      private String baseUrl;
      private String projectId;
      private Duration requestTimeout;
      private boolean awaitConfirmation = true;
      private Duration confirmationPoll;
      private Clock clock;

      private Builder() {}

      /**
       * Sets the network.
       *
       * @param network the x402 network
       * @return this builder
       */
      public Builder network(String network) {
        this.network = network;
        return this;
      }

      /**
       * Sets the base URL.
       *
       * @param baseUrl the URL
       * @return this builder
       */
      public Builder baseUrl(String baseUrl) {
        this.baseUrl = baseUrl;
        return this;
      }

      /**
       * Sets the project id.
       *
       * @param projectId the id
       * @return this builder
       */
      public Builder projectId(String projectId) {
        this.projectId = projectId;
        return this;
      }

      /**
       * Sets the per-request deadline.
       *
       * @param requestTimeout the deadline
       * @return this builder
       */
      public Builder requestTimeout(Duration requestTimeout) {
        this.requestTimeout = requestTimeout;
        return this;
      }

      /**
       * Sets whether submit waits for inclusion.
       *
       * @param awaitConfirmation the flag
       * @return this builder
       */
      public Builder awaitConfirmation(boolean awaitConfirmation) {
        this.awaitConfirmation = awaitConfirmation;
        return this;
      }

      /**
       * Sets the inclusion poll interval.
       *
       * @param confirmationPoll the interval
       * @return this builder
       */
      public Builder confirmationPoll(Duration confirmationPoll) {
        this.confirmationPoll = confirmationPoll;
        return this;
      }

      /**
       * Sets the clock.
       *
       * @param clock the clock
       * @return this builder
       */
      public Builder clock(Clock clock) {
        this.clock = clock;
        return this;
      }

      /**
       * Builds the config.
       *
       * @return the config
       */
      public Config build() {
        return new Config(
            network, baseUrl, projectId, requestTimeout, awaitConfirmation, confirmationPoll, clock);
      }
    }
  }

  /**
   * Creates the backend.
   *
   * @param config the settings
   */
  public BlockfrostChainBackend(Config config) {
    this.config = Objects.requireNonNull(config, "config");
    this.baseUrl = config.baseUrl().replaceAll("/+$", "");
    this.http = HttpClient.newBuilder().connectTimeout(config.requestTimeout()).build();
  }

  /**
   * Blockfrost's public URL for a network.
   *
   * @param network the x402 network
   * @return the base URL
   */
  public static String defaultBaseUrl(String network) {
    String n = CardanoNetworks.normalize(network);
    String name = n.substring(n.indexOf(':') + 1);
    return "https://cardano-" + name + ".blockfrost.io/api/v0";
  }

  private void assertNetwork(String network) {
    if (!Objects.equals(CardanoNetworks.normalize(network), CardanoNetworks.normalize(config.network()))) {
      throw new IllegalArgumentException(
          "Backend configured for " + config.network() + " but asked about " + network);
    }
  }

  @Override
  public UtxoSnapshot getUtxo(String ref, String network) {
    assertNetwork(network);
    CardanoUtils.UtxoRef parsed = CardanoUtils.parseUtxoRef(ref);
    JsonNode utxos = get("/txs/" + parsed.txHash() + "/utxos");
    if (utxos == null) {
      return UtxoSnapshot.spent(null);
    }
    JsonNode output = null;
    for (JsonNode o : utxos.path("outputs")) {
      if (o.path("output_index").isIntegralNumber()
          && o.get("output_index").bigIntegerValue().equals(parsed.index())) {
        output = o;
        break;
      }
    }
    if (output == null || !output.path("address").isTextual()) {
      return UtxoSnapshot.spent(null);
    }
    String address = output.get("address").asText();
    String keyHash = CardanoAddresses.paymentKeyHash(address);
    boolean spent;
    JsonNode consumed = output.get("consumed_by_tx");
    if (consumed != null) {
      spent = consumed.isTextual() && !consumed.asText().isEmpty();
    } else {
      spent = !inAddressUtxos(address, parsed);
    }
    if (spent) {
      return new UtxoSnapshot(false, address, null, null, keyHash);
    }
    BigInteger coin = BigInteger.ZERO;
    Map<String, BigInteger> assets = new LinkedHashMap<>();
    for (JsonNode amount : output.path("amount")) {
      String unit = amount.path("unit").asText();
      BigInteger quantity = new BigInteger(amount.path("quantity").asText());
      if ("lovelace".equals(unit)) {
        coin = quantity;
      } else if (unit.length() >= 56) {
        assets.put(
            unit.substring(0, 56).toLowerCase(Locale.ROOT) + "." + unit.substring(56).toLowerCase(Locale.ROOT),
            quantity);
      }
    }
    return new UtxoSnapshot(true, address, coin, assets, keyHash);
  }

  @Override
  public java.util.List<WalletUtxo> getAddressUtxos(String address, String network) {
    assertNetwork(network);
    java.util.List<WalletUtxo> result = new java.util.ArrayList<>();
    for (int page = 1; page <= MAX_ADDRESS_PAGES; page++) {
      JsonNode list = get("/addresses/" + address + "/utxos?count=100&page=" + page);
      if (list == null || !list.isArray() || list.isEmpty()) {
        break;
      }
      for (JsonNode u : list) {
        BigInteger coin = BigInteger.ZERO;
        Map<String, BigInteger> assets = new LinkedHashMap<>();
        for (JsonNode amount : u.path("amount")) {
          String unit = amount.path("unit").asText();
          BigInteger quantity = new BigInteger(amount.path("quantity").asText());
          if ("lovelace".equals(unit)) {
            coin = quantity;
          } else if (unit.length() >= 56) {
            assets.put(
                unit.substring(0, 56).toLowerCase(Locale.ROOT) + "." + unit.substring(56).toLowerCase(Locale.ROOT),
                quantity);
          }
        }
        result.add(
            new WalletUtxo(
                u.path("tx_hash").asText().toLowerCase(Locale.ROOT),
                u.path("output_index").asLong(),
                u.path("address").asText(address),
                coin,
                assets,
                u.hasNonNull("reference_script_hash")));
      }
      if (list.size() < 100) {
        break;
      }
    }
    return result;
  }

  private boolean inAddressUtxos(String address, CardanoUtils.UtxoRef ref) {
    for (int page = 1; page <= MAX_ADDRESS_PAGES; page++) {
      JsonNode list = get("/addresses/" + address + "/utxos?count=100&page=" + page);
      if (list == null || !list.isArray() || list.isEmpty()) {
        return false;
      }
      for (JsonNode u : list) {
        if (ref.txHash().equalsIgnoreCase(u.path("tx_hash").asText())
            && u.path("output_index").bigIntegerValue().equals(ref.index())) {
          return true;
        }
      }
    }
    return false;
  }

  @Override
  public long getCurrentSlot(String network) {
    assertNetwork(network);
    return CardanoNetworks.currentSlot(network, config.clock());
  }

  @Override
  public ProtocolParameters getProtocolParameters(String network) {
    assertNetwork(network);
    synchronized (cacheLock) {
      long now = config.clock().millis();
      if (cachedParameters == null || now - cachedAt > PROTOCOL_PARAMETERS_CACHE_MS) {
        JsonNode params = get("/epochs/latest/parameters");
        if (params == null) {
          throw new ChainLookupException("Blockfrost returned no protocol parameters");
        }
        cachedParameters =
            new ProtocolParameters(
                new BigInteger(params.path("coins_per_utxo_size").asText()),
                new BigInteger(params.path("min_fee_a").asText()),
                new BigInteger(params.path("min_fee_b").asText()));
        cachedAt = now;
      }
      return cachedParameters;
    }
  }

  @Override
  public SubmissionResult submitTransaction(String signedTransactionBase64, String network) {
    assertNetwork(network);
    byte[] cbor = Base64.getDecoder().decode(signedTransactionBase64);
    HttpRequest request =
        request("/tx/submit")
            .header("Content-Type", "application/cbor")
            .POST(HttpRequest.BodyPublishers.ofByteArray(cbor))
            .build();
    HttpResponse<String> response = send(request, "/tx/submit");
    if (response.statusCode() / 100 != 2) {
      throw new ChainLookupException(
          "Blockfrost /tx/submit failed: " + response.statusCode() + " " + response.body());
    }
    String txHash = parse(response.body()).asText().toLowerCase(Locale.ROOT);
    if (!config.awaitConfirmation()) {
      return new SubmissionResult(txHash, SettlementEvidence.Status.MEMPOOL);
    }
    // The broadcast succeeded; a failure while waiting must not read as a failed submission.
    try {
      return new SubmissionResult(
          txHash,
          awaitInclusion(txHash) ? SettlementEvidence.Status.CONFIRMED : SettlementEvidence.Status.MEMPOOL);
    } catch (RuntimeException e) {
      return new SubmissionResult(txHash, SettlementEvidence.Status.MEMPOOL);
    }
  }

  @Override
  public void waitForConfirmation(String txHash, String network) {
    assertNetwork(network);
    if (!awaitInclusion(txHash)) {
      throw new ChainLookupException("Cardano provider awaitTx timed out after " + config.requestTimeout().toMillis() + "ms");
    }
  }

  private boolean awaitInclusion(String txHash) {
    long start = config.clock().millis();
    long slept = 0;
    long timeout = config.requestTimeout().toMillis();
    long poll = Math.max(1, config.confirmationPoll().toMillis());
    while (true) {
      if (get("/txs/" + txHash) != null) {
        return true;
      }
      long elapsed = Math.max(config.clock().millis() - start, slept);
      if (elapsed + poll > timeout) {
        return false;
      }
      try {
        Thread.sleep(poll);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return false;
      }
      slept += poll;
    }
  }

  @Override
  public void evaluateTransaction(String signedTransactionBase64, String network) {
    assertNetwork(network);
    ObjectNode body = X402Json.mapper().createObjectNode();
    body.put("cbor", HexFormat.of().formatHex(Base64.getDecoder().decode(signedTransactionBase64)));
    body.putArray("additionalUtxoSet");
    HttpRequest request =
        request("/utils/txs/evaluate/utxos")
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
            .build();
    HttpResponse<String> response = send(request, "/utils/txs/evaluate/utxos");
    if (response.statusCode() / 100 != 2) {
      throw new ChainLookupException(
          "Blockfrost evaluateTx failed: " + response.statusCode() + " " + response.body());
    }
    JsonNode result = parse(response.body());
    if ("jsonwsp/fault".equals(result.path("type").asText())) {
      throw new ChainLookupException(
          "Blockfrost evaluation fault: " + result.path("fault").path("string").asText("unknown fault"));
    }
    JsonNode inner = result.get("result");
    if (inner == null || inner.isNull()) {
      throw new ChainLookupException("Blockfrost evaluation returned no result");
    }
    if (inner.hasNonNull("EvaluationFailure")) {
      throw new ChainLookupException(
          "Blockfrost script evaluation failed: " + inner.get("EvaluationFailure"));
    }
    if (!inner.hasNonNull("EvaluationResult")) {
      throw new ChainLookupException("Blockfrost evaluation returned no result");
    }
  }

  @Override
  public boolean supportsTransactionEvidence() {
    return true;
  }

  @Override
  public SettlementEvidence getTransactionEvidence(String txHash, String network) {
    assertNetwork(network);
    JsonNode tx = get("/txs/" + txHash);
    if (tx == null) {
      // Not on chain; Blockfrost cannot read the mempool.
      return SettlementEvidence.unknown();
    }
    if (tx.has("valid_contract") && tx.get("valid_contract").isBoolean() && !tx.get("valid_contract").asBoolean()) {
      return SettlementEvidence.unknown();
    }
    JsonNode tip = get("/blocks/latest");
    JsonNode txHeight = tx.get("block_height");
    JsonNode tipHeight = tip == null ? null : tip.get("height");
    if (txHeight == null || !txHeight.isNumber() || tipHeight == null || !tipHeight.isNumber()) {
      return new SettlementEvidence(SettlementEvidence.Status.CONFIRMED, 0);
    }
    long depth = Math.max(0, tipHeight.asLong() - txHeight.asLong());
    return new SettlementEvidence(SettlementEvidence.Status.CONFIRMED, (int) Math.min(depth, Integer.MAX_VALUE));
  }

  private HttpRequest.Builder request(String path) {
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create(baseUrl + path)).timeout(config.requestTimeout());
    if (config.projectId() != null && !config.projectId().isEmpty()) {
      builder.header("project_id", config.projectId());
    }
    return builder;
  }

  private JsonNode get(String path) {
    HttpResponse<String> response = send(request(path).GET().build(), path);
    if (response.statusCode() == 404) {
      return null;
    }
    if (response.statusCode() / 100 != 2) {
      throw new ChainLookupException(
          "Blockfrost " + path + " failed: " + response.statusCode() + " " + response.body());
    }
    return parse(response.body());
  }

  private HttpResponse<String> send(HttpRequest request, String path) {
    try {
      return http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    } catch (IOException e) {
      throw new ChainLookupException("Blockfrost " + path + " failed: " + e.getMessage(), e);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new ChainLookupException("Blockfrost " + path + " interrupted", e);
    }
  }

  private static JsonNode parse(String body) {
    try {
      return X402Json.mapper().readTree(body);
    } catch (IOException e) {
      throw new ChainLookupException("Blockfrost returned malformed JSON", e);
    }
  }
}
