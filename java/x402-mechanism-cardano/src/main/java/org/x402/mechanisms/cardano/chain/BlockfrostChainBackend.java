package org.x402.mechanisms.cardano.chain;

import com.bloxbean.cardano.client.api.ProtocolParamsSupplier;
import com.bloxbean.cardano.client.api.UtxoSupplier;
import com.bloxbean.cardano.client.api.common.OrderEnum;
import com.bloxbean.cardano.client.api.model.ProtocolParams;
import com.bloxbean.cardano.client.api.model.Utxo;
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
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import org.x402.core.json.X402Json;
import org.x402.mechanisms.cardano.CardanoAddresses;
import org.x402.mechanisms.cardano.CardanoNetworks;
import org.x402.mechanisms.cardano.CardanoUtils;

/**
 * {@link CardanoChainBackend} over the Blockfrost REST API, including
 * the transaction-evidence read that lets the facilitator advertise and settle {@code
 * l1Confirmations} above 0. One instance serves one network. It also serves a buyer wallet as a
 * cardano-client-lib {@link UtxoSupplier} and {@link ProtocolParamsSupplier}; unlike that
 * library's own suppliers, a failed read throws instead of answering an empty or short list.
 * Requests go through this class' own HTTP client so each one honours {@code requestTimeout}.
 * Thread-safe.
 */
public final class BlockfrostChainBackend
    implements CardanoChainBackend, UtxoSupplier, ProtocolParamsSupplier {

  private static final long PROTOCOL_PARAMETERS_CACHE_MS = 10 * 60_000L;
  private static final int MAX_ADDRESS_PAGES = 50;

  private final Config config;
  private final String baseUrl;
  private final HttpClient http;
  private final Object cacheLock = new Object();
  private ProtocolParams cachedParameters;
  private long cachedAt;

  /**
   * Backend settings.
   *
   * @param network the x402 Cardano network this backend serves
   * @param baseUrl Blockfrost base URL, e.g. {@code https://cardano-preprod.blockfrost.io/api/v0}
   * @param projectId Blockfrost project id, or {@code null} for a self-hosted instance
   * @param requestTimeout deadline per request (1 ms – 120 s, default 10 s)
   * @param awaitConfirmation whether {@code submitTransaction} waits (up to the request timeout)
   *     for inclusion before answering (default {@code true})
   * @param confirmationPoll poll interval of that wait (default 5 s)
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
     * A builder with the default timeout, confirmation wait and poll interval.
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
   * The network this backend serves.
   *
   * @return the x402 network
   */
  public String network() {
    return config.network();
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
    if (!utxos.path("outputs").isArray()) {
      throw new ChainLookupException("Blockfrost returned a malformed transaction output list");
    }
    JsonNode output = null;
    for (JsonNode o : utxos.path("outputs")) {
      if (!o.path("output_index").isIntegralNumber()) {
        throw new ChainLookupException("Blockfrost returned an output without an index");
      }
      if (o.get("output_index").bigIntegerValue().equals(parsed.index())) {
        output = o;
        break;
      }
    }
    if (output == null) {
      return UtxoSnapshot.spent(null);
    }
    if (!output.path("address").isTextual()) {
      throw new ChainLookupException("Blockfrost returned an output without an address");
    }
    String address = output.get("address").asText();
    String keyHash = CardanoAddresses.paymentKeyHash(address);
    boolean spent;
    JsonNode consumed = output.get("consumed_by_tx");
    if (consumed != null) {
      // null: unspent; otherwise the spending transaction's id.
      if (!consumed.isNull() && !(consumed.isTextual() && consumed.asText().matches("[0-9a-fA-F]{64}"))) {
        throw new ChainLookupException("Blockfrost returned a malformed consumed_by_tx");
      }
      spent = !consumed.isNull();
    } else {
      spent = !inAddressUtxos(address, parsed);
    }
    if (spent) {
      return new UtxoSnapshot(false, address, null, null, keyHash);
    }
    Value value = value(output.path("amount"));
    return new UtxoSnapshot(true, address, value.coin(), value.assets(), keyHash);
  }

  /** Lovelace and native assets ({@code policy.assetName}, lowercase) of a Blockfrost amount list. */
  private record Value(BigInteger coin, Map<String, BigInteger> assets) {}

  private static Value value(JsonNode amounts) {
    BigInteger coin = BigInteger.ZERO;
    Map<String, BigInteger> assets = new LinkedHashMap<>();
    for (JsonNode amount : amounts) {
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
    return new Value(coin, assets);
  }

  /**
   * The unspent outputs at an address, in Blockfrost's order, at most {@value #MAX_ADDRESS_PAGES}
   * pages of 100.
   *
   * @param address the address
   * @return the UTxOs (empty when the address has none)
   * @throws ChainLookupException when a page cannot be read
   */
  @Override
  public List<Utxo> getAll(String address) {
    List<Utxo> result = new ArrayList<>();
    for (int page = 0; page < MAX_ADDRESS_PAGES; page++) {
      List<Utxo> items = getPage(address, 100, page, OrderEnum.asc);
      result.addAll(items);
      if (items.size() < 100) {
        break;
      }
    }
    return result;
  }

  /**
   * One page of an address' unspent outputs.
   *
   * @param address the address
   * @param nrOfItems the page size (Blockfrost allows 1–100)
   * @param page the page, from 0
   * @param order the order
   * @return the page (empty past the end)
   * @throws ChainLookupException when the page cannot be read
   */
  @Override
  public List<Utxo> getPage(String address, Integer nrOfItems, Integer page, OrderEnum order) {
    int count = nrOfItems == null ? 100 : nrOfItems;
    int from = page == null ? 0 : page;
    String sort = order == OrderEnum.desc ? "desc" : "asc";
    JsonNode list = get("/addresses/" + address + "/utxos?count=" + count + "&page=" + (from + 1)
        + "&order=" + sort);
    List<Utxo> items = new ArrayList<>();
    if (list == null) {
      // Blockfrost answers 404 for an address without UTxOs, or past its last page.
      return items;
    }
    if (!list.isArray()) {
      throw new ChainLookupException("Blockfrost returned a malformed UTxO page");
    }
    for (JsonNode u : list) {
      items.add(toUtxo(u, address));
    }
    return items;
  }

  /**
   * An unspent output by reference, with its lovelace and native assets only (no datum or
   * reference-script fields). Unlike the library's own suppliers it answers empty for a spent
   * output.
   *
   * @param txHash the transaction id
   * @param outputIndex the output index
   * @return the output, or empty when it does not exist or is spent
   * @throws ChainLookupException when the read fails
   */
  @Override
  public Optional<Utxo> getTxOutput(String txHash, int outputIndex) {
    UtxoSnapshot snapshot = getUtxo(txHash + "#" + outputIndex, config.network());
    if (!snapshot.exists()) {
      return Optional.empty();
    }
    List<com.bloxbean.cardano.client.api.model.Amount> amounts = new ArrayList<>();
    amounts.add(new com.bloxbean.cardano.client.api.model.Amount("lovelace", snapshot.coin()));
    snapshot.assets().forEach((unit, quantity) -> amounts.add(
        new com.bloxbean.cardano.client.api.model.Amount(unit.replace(".", ""), quantity)));
    return Optional.of(Utxo.builder().txHash(txHash.toLowerCase(Locale.ROOT)).outputIndex(outputIndex)
        .address(snapshot.address()).amount(amounts).build());
  }

  private static Utxo toUtxo(JsonNode u, String address) {
    Utxo utxo;
    try {
      utxo = X402Json.mapper().treeToValue(u, Utxo.class);
    } catch (IOException | IllegalArgumentException e) {
      throw new ChainLookupException("Blockfrost returned a malformed UTxO", e);
    }
    if (utxo.getTxHash() == null || utxo.getAmount() == null) {
      throw new ChainLookupException("Blockfrost returned a malformed UTxO");
    }
    utxo.setTxHash(utxo.getTxHash().toLowerCase(Locale.ROOT));
    if (utxo.getAddress() == null) {
      utxo.setAddress(address);
    }
    return utxo;
  }

  private boolean inAddressUtxos(String address, CardanoUtils.UtxoRef ref) {
    for (int page = 1; page <= MAX_ADDRESS_PAGES; page++) {
      JsonNode list = get("/addresses/" + address + "/utxos?count=100&page=" + page);
      if (list != null && !list.isArray()) {
        throw new ChainLookupException("Blockfrost returned a malformed UTxO page");
      }
      if (list == null || list.isEmpty()) {
        // Blockfrost answers 404 for an address without UTxOs.
        return false;
      }
      for (JsonNode u : list) {
        if (!u.path("output_index").isIntegralNumber()) {
          throw new ChainLookupException("Blockfrost returned a UTxO without an output index");
        }
        if (ref.txHash().equalsIgnoreCase(u.path("tx_hash").asText())
            && u.path("output_index").bigIntegerValue().equals(ref.index())) {
          return true;
        }
      }
      if (list.size() < 100) {
        return false;
      }
    }
    // Pages left unread: the output may still be there, so this is not a "spent" answer.
    throw new ChainLookupException(
        "address holds more than " + MAX_ADDRESS_PAGES * 100 + " UTxOs; cannot tell whether "
            + ref.txHash() + "#" + ref.index() + " is unspent");
  }

  @Override
  public long getCurrentSlot(String network) {
    assertNetwork(network);
    return CardanoNetworks.currentSlot(network, config.clock());
  }

  @Override
  public ProtocolParams getProtocolParameters(String network) {
    assertNetwork(network);
    return getProtocolParams();
  }

  /**
   * Live protocol parameters of this backend's network, cached for ten minutes. The cached
   * instance is shared; callers must not modify it.
   *
   * @return the parameters
   * @throws ChainLookupException when they cannot be read or lack the fee and min-UTxO values
   */
  @Override
  public ProtocolParams getProtocolParams() {
    synchronized (cacheLock) {
      long now = config.clock().millis();
      if (cachedParameters == null || now - cachedAt > PROTOCOL_PARAMETERS_CACHE_MS) {
        JsonNode params = get("/epochs/latest/parameters");
        if (params == null) {
          throw new ChainLookupException("Blockfrost returned no protocol parameters");
        }
        ProtocolParams parsed;
        try {
          parsed = CardanoUtils.requireComplete(X402Json.mapper().treeToValue(params, ProtocolParams.class));
        } catch (IOException | IllegalArgumentException e) {
          throw new ChainLookupException("Blockfrost returned malformed protocol parameters", e);
        }
        cachedParameters = parsed;
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
    if (!tx.isObject() || !tx.path("hash").isTextual()
        || !tx.get("hash").asText().matches("[0-9a-fA-F]{64}")
        || !tx.get("hash").asText().equalsIgnoreCase(txHash)) {
      // Inclusion evidence only counts for the transaction that was asked about.
      throw new ChainLookupException("Blockfrost returned evidence for another transaction");
    }
    JsonNode validContract = tx.get("valid_contract");
    if (validContract != null && !validContract.isNull() && !validContract.isBoolean()) {
      throw new ChainLookupException("Blockfrost returned a malformed valid_contract");
    }
    if (validContract != null && validContract.isBoolean() && !validContract.asBoolean()) {
      return SettlementEvidence.unknown();
    }
    JsonNode txHeight = tx.get("block_height");
    if (!isHeight(txHeight)) {
      throw new ChainLookupException("Blockfrost returned a transaction without a block height");
    }
    JsonNode tip = get("/blocks/latest");
    JsonNode tipHeight = tip == null ? null : tip.get("height");
    if (!isHeight(tipHeight)) {
      throw new ChainLookupException("Blockfrost returned no readable chain tip");
    }
    BigInteger depth = tipHeight.bigIntegerValue().subtract(txHeight.bigIntegerValue()).max(BigInteger.ZERO);
    return new SettlementEvidence(SettlementEvidence.Status.CONFIRMED,
        depth.min(BigInteger.valueOf(Integer.MAX_VALUE)).intValueExact());
  }

  /** A block height: a non-negative integer that fits a long. */
  private static boolean isHeight(JsonNode node) {
    return node != null && node.isIntegralNumber() && node.canConvertToLong() && node.asLong() >= 0;
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
