package org.x402.spring.extensions;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.x402.extensions.bazaar.Bazaar;
import org.x402.extensions.bazaar.DiscoveryOutput;
import org.x402.extensions.bazaar.HttpDiscoveryConfig;
import org.x402.http.RouteConfig;
import org.x402.spring.X402ConfigurationException;
import org.x402.spring.X402RouteCustomizer;

/**
 * Turns {@code x402.routes.<offer>.extensions.bazaar} from YAML into the WP9a declaration (TS
 * {@code declareDiscoveryExtension}). Keys: {@code discoverable} ({@code false} omits the
 * extension), {@code method}, {@code input}, {@code input-schema}, {@code path-params}, {@code
 * path-params-schema}, {@code body-type} ({@code json}, {@code form-data}, {@code text}) and
 * {@code output.{example, schema}}. The method is narrowed per request by the bazaar server
 * extension.
 */
public final class BazaarDeclarations implements X402RouteCustomizer {

  private static final Set<String> KEYS = Set.of("discoverable", "method", "input",
      "input-schema", "inputSchema", "path-params", "pathParams", "path-params-schema",
      "pathParamsSchema", "body-type", "bodyType", "output");

  @Override
  public RouteConfig customize(String offer, RouteConfig route) {
    Map<String, Object> extensions = route.extensions();
    if (extensions == null || !extensions.containsKey(Bazaar.KEY)) {
      return route;
    }
    Object raw = restore(extensions.get(Bazaar.KEY));
    Map<String, Object> out = new LinkedHashMap<>(extensions);
    out.remove(Bazaar.KEY);
    if (raw instanceof Map<?, ?> map) {
      for (Object key : map.keySet()) {
        if (!KEYS.contains(String.valueOf(key))) {
          throw new X402ConfigurationException("offer \"" + offer + "\": unknown "
              + "extensions.bazaar key \"" + key + "\"; allowed: discoverable, method, input, "
              + "input-schema, path-params, path-params-schema, body-type, output");
        }
      }
      if (!isFalse(map.get("discoverable"))) {
        out.putAll(Bazaar.declareDiscoveryExtension(config(offer, map)));
      }
    } else if (!isFalse(raw)) {
      out.putAll(Bazaar.declareDiscoveryExtension(HttpDiscoveryConfig.create()));
    }
    return new RouteConfig(route.accepts(), route.resource(), route.description(),
        route.mimeType(), route.serviceName(), route.tags(), route.iconUrl(),
        route.customPaywallHtml(), route.unpaidResponseBody(),
        route.settlementFailedResponseBody(), out.isEmpty() ? null : out, route.failover());
  }

  private static boolean isFalse(Object value) {
    return Boolean.FALSE.equals(value) || "false".equalsIgnoreCase(String.valueOf(value));
  }

  private static HttpDiscoveryConfig config(String offer, Map<?, ?> map) {
    HttpDiscoveryConfig config = HttpDiscoveryConfig.create();
    if (map.get("method") != null) {
      config.method(String.valueOf(map.get("method")));
    }
    Map<String, Object> input = object(offer, map, "input");
    if (input != null) {
      config.input(input);
    }
    Map<String, Object> inputSchema = object(offer, map, "input-schema", "inputSchema");
    if (inputSchema != null) {
      config.inputSchema(inputSchema);
    }
    Map<String, Object> pathParams = object(offer, map, "path-params", "pathParams");
    if (pathParams != null) {
      config.pathParams(pathParams);
    }
    Map<String, Object> pathSchema =
        object(offer, map, "path-params-schema", "pathParamsSchema");
    if (pathSchema != null) {
      config.pathParamsSchema(pathSchema);
    }
    Object bodyType = map.get("body-type") != null ? map.get("body-type") : map.get("bodyType");
    if (bodyType != null) {
      try {
        config.bodyType(String.valueOf(bodyType));
      } catch (IllegalArgumentException e) {
        throw new X402ConfigurationException("offer \"" + offer + "\": extensions.bazaar."
            + "body-type: " + e.getMessage());
      }
    }
    Map<String, Object> output = object(offer, map, "output");
    if (output != null) {
      Object schema = output.get("schema");
      config.output(new DiscoveryOutput(output.get("example"),
          schema instanceof Map<?, ?> s ? cast(s) : null));
    }
    return config;
  }

  private static Map<String, Object> object(String offer, Map<?, ?> map, String... keys) {
    for (String key : keys) {
      Object value = map.get(key);
      if (value == null) {
        continue;
      }
      if (!(value instanceof Map<?, ?> m)) {
        throw new X402ConfigurationException("offer \"" + offer + "\": extensions.bazaar."
            + key + " must be an object");
      }
      return cast(m);
    }
    return null;
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> cast(Map<?, ?> map) {
    return (Map<String, Object>) map;
  }

  /** Spring binds lists inside {@code Map<String, Object>} as maps keyed "0", "1", …. */
  static Object restore(Object value) {
    if (value instanceof Map<?, ?> map) {
      boolean indexed = !map.isEmpty();
      for (int i = 0; i < map.size() && indexed; i++) {
        indexed = map.containsKey(String.valueOf(i));
      }
      if (indexed) {
        List<Object> list = new ArrayList<>();
        for (int i = 0; i < map.size(); i++) {
          list.add(restore(map.get(String.valueOf(i))));
        }
        return list;
      }
      Map<String, Object> out = new LinkedHashMap<>();
      map.forEach((k, v) -> out.put(String.valueOf(k), restore(v)));
      return out;
    }
    if (value instanceof List<?> list) {
      List<Object> out = new ArrayList<>();
      list.forEach(v -> out.add(restore(v)));
      return out;
    }
    return value;
  }
}
