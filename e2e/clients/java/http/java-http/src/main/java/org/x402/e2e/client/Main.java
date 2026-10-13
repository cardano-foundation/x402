package org.x402.e2e.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.PrintStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.x402.core.client.SpendControls;
import org.x402.core.client.X402Client;
import org.x402.core.json.X402Json;
import org.x402.core.types.SettleResponse;
import org.x402.http.X402HttpClient;
import org.x402.mechanisms.cardano.CardanoNetworks;
import org.x402.mechanisms.cardano.chain.BlockfrostChainBackend;
import org.x402.mechanisms.cardano.exact.client.ExactCardanoClientScheme;
import org.x402.mechanisms.cardano.signer.ClientCardanoSignerConfig;
import org.x402.mechanisms.cardano.signer.MnemonicClientCardanoSigner;

/**
 * One-shot x402 e2e client (Java v2 SDK, Cardano only).
 *
 * <p>Env: {@code RESOURCE_SERVER_URL}, {@code ENDPOINT_PATH}, {@code CLIENT_CARDANO_MNEMONIC},
 * {@code BLOCKFROST_PROJECT_ID}, optional {@code CARDANO_NETWORK} (harness-injected, default
 * {@code cardano:preprod}) and {@code CARDANO_RPC_URL} (Blockfrost base URL, default per network).
 *
 * <p>Prints exactly one JSON line on stdout. {@code success} is true only for a 2xx answer (and a
 * successful settlement when a {@code PAYMENT-RESPONSE} is present).
 *
 * <ul>
 *   <li>2xx or 402: {@code {success, data, status_code[, payment_response]}}, exit 0. The harness
 *       itself fails a 402 or a failed settlement.
 *   <li>Any other status (e.g. 503 while the server waits for a facilitator): the same line plus
 *       {@code error}, exit 1. With exit 0 the harness would treat it as a pass (decisions 170,
 *       193).
 *   <li>The request could not be completed: {@code {success: false, error}}, exit 1.
 * </ul>
 *
 * <p>Everything else goes to stderr.
 */
public final class Main {

  /** How long to wait for Blockfrost to list the payment's change output (TS e2e client: 120 s). */
  private static final Duration WALLET_SETTLE_TIMEOUT = Duration.ofSeconds(120);

  private static final Duration WALLET_SETTLE_POLL = Duration.ofSeconds(3);

  private Main() {}

  /**
   * Runs one paid GET and prints the result line.
   *
   * @param args unused
   */
  public static void main(String[] args) {
    // Keep stdout for the single result line; the harness takes the first line starting with '{'.
    PrintStream out = System.out;
    System.setOut(System.err);
    int exitCode;
    String line;
    try {
      Map<String, Object> result = run();
      int status = (Integer) result.get("status_code");
      exitCode = status / 100 == 2 || status == 402 ? 0 : 1;
      line = X402Json.write(result);
    } catch (Throwable e) {
      e.printStackTrace(System.err);
      Map<String, Object> failure = new LinkedHashMap<>();
      failure.put("success", false);
      failure.put("error", describe(e));
      line = X402Json.write(failure);
      exitCode = 1;
    }
    out.println(line);
    out.flush();
    // Exit explicitly: the JDK HttpClient's selector thread must not keep the process alive.
    System.exit(exitCode);
  }

  private static Map<String, Object> run() throws Exception {
    String baseUrl = requireEnv("RESOURCE_SERVER_URL");
    String endpointPath = requireEnv("ENDPOINT_PATH");
    String mnemonic = requireEnv("CLIENT_CARDANO_MNEMONIC");
    String projectId = requireEnv("BLOCKFROST_PROJECT_ID");
    String network = envOr("CARDANO_NETWORK", CardanoNetworks.PREPROD);
    String rpcUrl = envOr("CARDANO_RPC_URL", BlockfrostChainBackend.defaultBaseUrl(network));

    BlockfrostChainBackend blockfrost =
        new BlockfrostChainBackend(
            BlockfrostChainBackend.Config.builder()
                .network(network)
                .baseUrl(rpcUrl)
                .projectId(projectId)
                .build());
    MnemonicClientCardanoSigner signer =
        new MnemonicClientCardanoSigner(
            ClientCardanoSignerConfig.builder()
                .mnemonic(mnemonic)
                .network(network)
                .walletProvider(blockfrost)
                .build());

    // E2e routes are priced in lovelace (not a default asset) and above the $1 cap, so spend
    // controls are off, as in the TS e2e client (e2e/clients/typescript/client.ts).
    X402Client client =
        new X402Client()
            .setSpendControls(SpendControls.disabled())
            .register("cardano:*", new ExactCardanoClientScheme(signer));

    X402HttpClient http = X402HttpClient.wrap(HttpClient.newHttpClient(), client);
    // No per-request timeout: X402HttpClient applies its 240 s default.
    HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + endpointPath)).GET().build();
    HttpResponse<String> response =
        http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));

    Optional<SettleResponse> settle = X402HttpClient.paymentResponse(response);
    Object data = parseBody(response.body());

    int status = response.statusCode();
    boolean ok = status / 100 == 2;
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("success", ok && settle.map(SettleResponse::success).orElse(true));
    result.put("data", data);
    result.put("status_code", status);
    settle.ifPresent(s -> result.put("payment_response", s));
    if (!ok && status != 402) {
      result.put("error", "unexpected HTTP status " + status + " from " + endpointPath);
    }

    settle.ifPresent(s -> awaitWalletSettled(s, blockfrost, network));
    return result;
  }

  /**
   * Waits until Blockfrost lists this payment's change output (TS {@code
   * awaitCardanoWalletSettled}). Sequential e2e clients are separate processes and Blockfrost does
   * not see mempool spends, so the next client would otherwise build on the same input.
   */
  private static void awaitWalletSettled(
      SettleResponse settle, BlockfrostChainBackend blockfrost, String network) {
    if (settle.network() == null || !settle.network().startsWith("cardano:")) {
      return;
    }
    String transaction = settle.transaction();
    String payer = settle.payer();
    if (transaction == null || transaction.isEmpty() || payer == null || payer.isEmpty()) {
      return;
    }
    long deadline = System.nanoTime() + WALLET_SETTLE_TIMEOUT.toNanos();
    while (System.nanoTime() < deadline) {
      try {
        boolean listed =
            blockfrost.getAddressUtxos(payer, network).stream()
                .anyMatch(utxo -> transaction.equalsIgnoreCase(utxo.txHash()));
        if (listed) {
          return;
        }
      } catch (RuntimeException e) {
        // Transient Blockfrost/network error: keep polling until the deadline.
        System.err.println("[java-http] wallet settle poll failed: " + e.getMessage());
      }
      try {
        Thread.sleep(WALLET_SETTLE_POLL.toMillis());
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return;
      }
    }
    System.err.println("[java-http] change output of " + transaction + " not listed after "
        + WALLET_SETTLE_TIMEOUT.toSeconds() + " s");
  }

  private static Object parseBody(String body) {
    if (body == null || body.isEmpty()) {
      return null;
    }
    try {
      ObjectMapper mapper = X402Json.mapper();
      return mapper.readValue(body, Object.class);
    } catch (Exception e) {
      return body;
    }
  }

  private static String describe(Throwable e) {
    StringBuilder message = new StringBuilder(e.getClass().getSimpleName());
    if (e.getMessage() != null) {
      message.append(": ").append(e.getMessage());
    }
    Throwable cause = e.getCause();
    if (cause != null && cause != e && cause.getMessage() != null) {
      message.append(" (cause: ").append(cause.getMessage()).append(')');
    }
    return message.toString();
  }

  private static String requireEnv(String name) {
    String value = System.getenv(name);
    if (value == null || value.isBlank()) {
      throw new IllegalStateException(name + " is required");
    }
    return value.trim();
  }

  private static String envOr(String name, String fallback) {
    String value = System.getenv(name);
    return value == null || value.isBlank() ? fallback : value.trim();
  }
}
