package org.x402.e2e.server;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;

/**
 * Turns the e2e catalog and the harness environment into Spring properties for the x402 starter
 * ({@code x402.facilitators}, {@code x402.accounts}, {@code x402.routes}), mirroring how the TS e2e
 * server resolves routes ({@code e2e/src/mechanisms.ts} {@code resolvePaymentRoutes}).
 *
 * <ul>
 *   <li>One account per (network, transfer method): {@code cardano} (SERVER_CARDANO_ADDRESS),
 *       {@code cardano-masumi} (derived escrow, seller mnemonic), {@code cardano-script}
 *       (SERVER_CARDANO_SCRIPT_ADDRESS, else the always-succeeds fixture). The transfer method sits
 *       on the account; CARDANO_L1_CONFIRMATIONS becomes each account's {@code
 *       cardano.l1-confirmations}.
 *   <li>One offer per catalog route with one {@code accepts} entry. The catalog {@code extra}
 *       (script block, {@code paymentFlow}, requirements/scheme extra) goes into that entry's
 *       {@code extra}; there is no offer-level {@code extra}.
 *   <li>{@link #ANNOTATED_PATH} is served by an {@code @X402Payment} controller (no {@code path:});
 *       every other route gets {@code path: "GET <path>"} and a catalog-driven handler.
 * </ul>
 */
public final class E2eServerConfig {

  /** The fixed success body message of every paid route. */
  public static final String PROTECTED_ROUTE_MESSAGE = "Protected endpoint accessed successfully";

  /** The route served by the annotated controller, so the annotation path runs in e2e. */
  public static final String ANNOTATED_PATH = "/exact/cardano/default";

  /** The offer name of {@link #ANNOTATED_PATH} ({@link #offerName}), used by {@code @X402Payment}. */
  public static final String ANNOTATED_OFFER = "exact-cardano-default";

  /** Property listing the paths that need the catalog-driven handler (comma-separated). */
  public static final String CATALOG_PATHS_PROPERTY = "e2e.catalog-paths";

  /** Property set to {@code true} when {@link #ANNOTATED_PATH} is served. */
  public static final String ANNOTATED_ROUTE_PROPERTY = "e2e.annotated-route";

  /** always-succeeds Plutus V3 fixture, same bytes as the TS e2e server. */
  static final String ALWAYS_SUCCEEDS_SCRIPT = "4d01000033222220051200120011";

  static final String ALWAYS_SUCCEEDS_DATUM = "d8799f182aff";

  static final String ALWAYS_SUCCEEDS_ADDRESS =
      "addr_test1wp8l7eylksmjas7ypzm0q35dwnjdxxvsfn0z0lflqzgs55stpd682";

  private final Map<String, Object> properties;
  private final List<String> mountedPaths;
  private final List<String> skipped;

  private E2eServerConfig(Map<String, Object> properties, List<String> mountedPaths,
      List<String> skipped) {
    this.properties = properties;
    this.mountedPaths = mountedPaths;
    this.skipped = skipped;
  }

  /**
   * Builds the properties from the process environment.
   *
   * @return the configuration
   */
  public static E2eServerConfig fromEnvironment() {
    return build(System::getenv);
  }

  /**
   * Builds the properties.
   *
   * @param env environment lookup
   * @return the configuration
   */
  public static E2eServerConfig build(Function<String, String> env) {
    E2eCatalog catalog = E2eCatalog.load(env);
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("server.port", envOr(env, "PORT", "4021"));

    String facilitatorUrl = env.apply("FACILITATOR_URL");
    if (E2eCatalog.isBlank(facilitatorUrl)) {
      throw new IllegalStateException("FACILITATOR_URL environment variable is required");
    }
    p.put("x402.facilitators[0].url", facilitatorUrl.trim());
    String mock = env.apply("MOCK_FACILITATOR_URL");
    if (!E2eCatalog.isBlank(mock)) {
      p.put("x402.facilitators[1].url", mock.trim());
    }

    Integer l1Confirmations = l1Confirmations(env.apply("CARDANO_L1_CONFIRMATIONS"));
    List<String> mounted = new ArrayList<>();
    List<String> catalogPaths = new ArrayList<>();
    List<String> skipped = new ArrayList<>();
    Map<String, Boolean> accounts = new LinkedHashMap<>();

    for (E2eCatalog.Route route : catalog.routes()) {
      E2eCatalog.Network network = catalog.network(route.network());
      String serverPayTo = env.apply("SERVER_" + route.network().toUpperCase(Locale.ROOT)
          + "_ADDRESS");
      if (E2eCatalog.isBlank(serverPayTo)) {
        skipped.add(route.path() + " (no SERVER_" + route.network().toUpperCase(Locale.ROOT)
            + "_ADDRESS)");
        continue;
      }
      if (route.settlementOverride()) {
        throw new IllegalStateException("route " + route.path()
            + ": settlementOverride is not supported by the Java e2e server");
      }
      String caip2 = envOr(env, route.network().toUpperCase(Locale.ROOT) + "_NETWORK",
          network.testnetCaip2());
      boolean cardano = "cardano".equals(route.network());
      String method = route.assetTransferMethod();
      String sellerMnemonic = env.apply("SERVER_CARDANO_SELLER_MNEMONIC");
      if (cardano && "masumi".equals(method) && E2eCatalog.isBlank(sellerMnemonic)) {
        skipped.add(route.path() + " (no SERVER_CARDANO_SELLER_MNEMONIC)");
        continue;
      }

      String account = method == null || "default".equals(method)
          ? route.network() : route.network() + "-" + method;
      if (accounts.putIfAbsent(account, Boolean.TRUE) == null) {
        String a = "x402.accounts." + account + ".";
        p.put(a + "network", caip2);
        if (cardano && "masumi".equals(method)) {
          // No pay-to: the starter derives the canonical escrow address of the network.
          p.put(a + "cardano.masumi.seller-mnemonic", sellerMnemonic.trim());
        } else if (cardano && "script".equals(method)) {
          p.put(a + "pay-to", envOr(env, "SERVER_CARDANO_SCRIPT_ADDRESS", ALWAYS_SUCCEEDS_ADDRESS));
        } else {
          p.put(a + "pay-to", serverPayTo.trim());
        }
        if (method != null && !"default".equals(method)) {
          p.put(a + "extra.assetTransferMethod", method);
        }
        if (cardano && l1Confirmations != null) {
          p.put(a + "cardano.l1-confirmations", l1Confirmations);
        }
      }

      String offer = offerName(route.path());
      String o = "x402.routes." + offer + ".";
      String accept = o + "accepts[0].";
      p.put(accept + "account", account);
      if (!"exact".equals(route.scheme())) {
        p.put(accept + "scheme", route.scheme());
      }
      putPrice(p, accept, route, env);
      if (route.maxTimeoutSeconds() != null) {
        p.put(accept + "max-timeout-seconds", route.maxTimeoutSeconds());
      }
      if (route.requirementsExtra() != null) {
        flatten(p, accept + "extra", route.requirementsExtra());
      }
      if (cardano && "script".equals(method)) {
        p.put(accept + "extra.script.type", "plutusV3");
        p.put(accept + "extra.script.code", envOr(env, "SERVER_CARDANO_SCRIPT_CODE",
            ALWAYS_SUCCEEDS_SCRIPT));
        p.put(accept + "extra.datum", envOr(env, "SERVER_CARDANO_SCRIPT_DATUM",
            ALWAYS_SUCCEEDS_DATUM));
      }
      if (route.paymentFlow() != null && !"authorization".equals(route.paymentFlow())) {
        p.put(accept + "extra.paymentFlow", route.paymentFlow());
      }
      if (route.schemeExtra() != null) {
        flatten(p, accept + "extra", route.schemeExtra());
      }
      for (String extension : route.extensions()) {
        if (!"bazaar".equals(extension)) {
          throw new IllegalStateException("route " + route.path() + " declares extension \""
              + extension + "\", which the Java e2e server does not declare");
        }
        putBazaar(p, o + "extensions.bazaar.");
      }

      if (ANNOTATED_PATH.equals(route.path())) {
        p.put(ANNOTATED_ROUTE_PROPERTY, "true");
      } else {
        p.put(o + "path", "GET " + route.path());
        catalogPaths.add(route.path());
      }
      mounted.add(route.path());
    }
    p.put(CATALOG_PATHS_PROPERTY, String.join(",", catalogPaths));
    return new E2eServerConfig(Map.copyOf(p), List.copyOf(mounted), List.copyOf(skipped));
  }

  /**
   * The Spring properties (use as {@code SpringApplication} default properties).
   *
   * @return the properties
   */
  public Map<String, Object> properties() {
    return properties;
  }

  /**
   * The paid paths this server mounts.
   *
   * @return the paths
   */
  public List<String> mountedPaths() {
    return mountedPaths;
  }

  /**
   * Catalog routes left out, with the reason.
   *
   * @return the routes
   */
  public List<String> skipped() {
    return skipped;
  }

  /**
   * The offer name of a catalog path: {@code /exact/cardano/default} → {@code
   * exact-cardano-default}.
   *
   * @param path the route path
   * @return the offer name
   */
  public static String offerName(String path) {
    String name = path.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-")
        .replaceAll("^-+|-+$", "");
    return name.isEmpty() ? "root" : name;
  }

  /**
   * The success body of every paid route.
   *
   * @return the body
   */
  public static Map<String, Object> successBody() {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("message", PROTECTED_ROUTE_MESSAGE);
    body.put("timestamp", java.time.Instant.now().toString());
    return body;
  }

  private static void putPrice(Map<String, Object> p, String accept, E2eCatalog.Route route,
      Function<String, String> env) {
    E2eCatalog.Price price = route.price();
    if (price.usd() != null) {
      p.put(accept + "price", price.usd());
      return;
    }
    String amount = price.amountEnv() == null ? null : env.apply(price.amountEnv());
    amount = E2eCatalog.isBlank(amount) ? price.amount() : amount.trim();
    String asset = price.assetEnv() == null ? null : env.apply(price.assetEnv());
    asset = E2eCatalog.isBlank(asset) ? price.asset() : asset.trim();
    if (amount == null || asset == null) {
      throw new IllegalStateException("route " + route.path() + ": price has no amount/asset");
    }
    p.put(accept + "price.amount", amount);
    p.put(accept + "price.asset", asset);
  }

  /** Bazaar declaration matching the TS e2e server's {@code routeDiscoveryOutput()}. */
  private static void putBazaar(Map<String, Object> p, String b) {
    p.put(b + "output.example.message", PROTECTED_ROUTE_MESSAGE);
    p.put(b + "output.example.timestamp", "2024-01-01T00:00:00Z");
    p.put(b + "output.schema.properties.message.type", "string");
    p.put(b + "output.schema.properties.timestamp.type", "string");
    p.put(b + "output.schema.required[0]", "message");
    p.put(b + "output.schema.required[1]", "timestamp");
  }

  private static void flatten(Map<String, Object> p, String prefix, JsonNode node) {
    if (node.isObject()) {
      Iterator<Map.Entry<String, JsonNode>> it = node.fields();
      while (it.hasNext()) {
        Map.Entry<String, JsonNode> e = it.next();
        flatten(p, prefix + "." + e.getKey(), e.getValue());
      }
    } else if (node.isArray()) {
      // One List value: index-keyed properties would bind as a map {"0": …, "1": …} under
      // Map<String, Object> (decision 141), while a List value passes through as a JSON array.
      p.put(prefix, new com.fasterxml.jackson.databind.ObjectMapper().convertValue(node,
          java.util.List.class));
    } else if (node.isBoolean()) {
      p.put(prefix, node.booleanValue());
    } else if (node.isIntegralNumber()) {
      // Keep JSON scalar types: default properties hold Objects, and Map<String, Object>
      // binding passes them through, so extra stays {"x": 1} rather than {"x": "1"}.
      p.put(prefix, node.canConvertToLong() ? (Object) node.longValue() : node.bigIntegerValue());
    } else if (node.isNumber()) {
      p.put(prefix, node.decimalValue());
    } else if (!node.isNull()) {
      p.put(prefix, node.asText());
    }
  }

  static Integer l1Confirmations(String raw) {
    if (E2eCatalog.isBlank(raw)) {
      return null;
    }
    String v = raw.trim();
    if (!v.matches("^-?(0|[1-9]\\d?)$")) {
      throw new IllegalStateException(
          "CARDANO_L1_CONFIRMATIONS must be a plain integer from -1 to 20, got \"" + v + "\"");
    }
    int n = Integer.parseInt(v);
    if (n < -1 || n > 20) {
      throw new IllegalStateException(
          "CARDANO_L1_CONFIRMATIONS must be an integer from -1 to 20, got \"" + v + "\"");
    }
    return n;
  }

  private static String envOr(Function<String, String> env, String key, String fallback) {
    String v = env.apply(key);
    return E2eCatalog.isBlank(v) ? fallback : v.trim();
  }
}
