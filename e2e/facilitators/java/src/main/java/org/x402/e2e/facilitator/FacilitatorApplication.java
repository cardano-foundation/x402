package org.x402.e2e.facilitator;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;

/**
 * x402 e2e facilitator: the Spring facilitator server of the x402 starter at the root base path
 * ({@code POST /verify}, {@code POST /settle}, {@code GET /supported}), plus {@code GET /health}
 * and {@code POST /close} for the harness.
 *
 * <p>Env (mirrors {@code e2e/facilitators/typescript/index.ts}): {@code PORT} (default 4022);
 * Cardano is registered only when both {@code CARDANO_RPC_URL} and {@code BLOCKFROST_PROJECT_ID}
 * are set; {@code FACILITATOR_CARDANO_MNEMONIC} is optional (provider-only without it); {@code
 * CARDANO_NETWORK} picks the one {@code networks[]} entry (default {@code cardano:preprod}); {@code
 * CARDANO_L1_CONFIRMATIONS=-1} turns on {@code accept-mempool}.
 */
@SpringBootApplication
public class FacilitatorApplication {

  static final String DEFAULT_NETWORK = "cardano:preprod";

  /**
   * Starts the facilitator.
   *
   * @param args the arguments
   */
  public static void main(String[] args) {
    Map<String, Object> properties = properties(System.getenv());
    boolean cardano = properties.containsKey("x402.facilitator-server.cardano.networks[0].network");
    System.out.println("x402 Java e2e facilitator: Cardano "
        + (cardano ? properties.get("x402.facilitator-server.cardano.networks[0].network")
            + (properties.containsKey("x402.facilitator-server.cardano.networks[0].mnemonic")
                ? "" : " (provider-only, no wallet)")
            : "not configured (CARDANO_RPC_URL and BLOCKFROST_PROJECT_ID required)"));
    SpringApplication app = new SpringApplication(FacilitatorApplication.class);
    app.setDefaultProperties(properties);
    app.addListeners((ApplicationReadyEvent event) -> {
      System.out.println("Facilitator listening on http://localhost:"
          + event.getApplicationContext().getEnvironment().getProperty("local.server.port"));
      System.out.flush();
    });
    app.run(args);
  }

  static Map<String, Object> properties(Map<String, String> env) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("server.port", value(env, "PORT", "4022"));
    p.put("x402.facilitator-server.enabled", "true");
    p.put("x402.facilitator-server.base-path", "/");
    p.put("x402.facilitator-server.cardano.accept-mempool",
        String.valueOf("-1".equals(value(env, "CARDANO_L1_CONFIRMATIONS", ""))));
    String rpcUrl = value(env, "CARDANO_RPC_URL", null);
    String projectId = value(env, "BLOCKFROST_PROJECT_ID", null);
    if (rpcUrl != null && projectId != null) {
      String n = "x402.facilitator-server.cardano.networks[0].";
      p.put(n + "network", value(env, "CARDANO_NETWORK", DEFAULT_NETWORK));
      p.put(n + "blockfrost.base-url", rpcUrl);
      p.put(n + "blockfrost.project-id", projectId);
      String mnemonic = value(env, "FACILITATOR_CARDANO_MNEMONIC", null);
      if (mnemonic != null) {
        p.put(n + "mnemonic", mnemonic);
      }
    }
    return p;
  }

  private static String value(Map<String, String> env, String key, String fallback) {
    String v = env.get(key);
    return v == null || v.isBlank() ? fallback : v.trim();
  }
}
