package org.x402.core.utils;

import java.util.Map;
import java.util.regex.Pattern;

/**
 * CAIP-2 network pattern matching, as TS {@code networkMatchesPattern}, {@code
 * findSchemesByNetwork} and {@code findByNetworkAndScheme} ({@code core/src/utils/index.ts}).
 */
public final class Networks {

  private Networks() {}

  /**
   * Whether a network matches a pattern in which {@code *} matches any run of characters.
   *
   * @param pattern the pattern, e.g. {@code cardano:*}, or an exact network
   * @param network the network
   * @return {@code true} on a full match
   */
  public static boolean matchesPattern(String pattern, String network) {
    if (pattern == null || network == null) {
      return false;
    }
    StringBuilder regex = new StringBuilder();
    int start = 0;
    int star;
    while ((star = pattern.indexOf('*', start)) >= 0) {
      if (star > start) {
        regex.append(Pattern.quote(pattern.substring(start, star)));
      }
      regex.append(".*");
      start = star + 1;
    }
    if (start < pattern.length()) {
      regex.append(Pattern.quote(pattern.substring(start)));
    }
    return Pattern.compile(regex.toString(), Pattern.DOTALL).matcher(network).matches();
  }

  /**
   * Finds the scheme map of a network: the exact key first, else the first pattern key (in map
   * iteration order) that matches. An exact key wins even when it lacks the wanted scheme.
   *
   * @param map network (or pattern) → scheme → value
   * @param network the network
   * @param <T> the value type
   * @return the scheme map, or {@code null}
   */
  public static <T> Map<String, T> findSchemesByNetwork(
      Map<String, ? extends Map<String, T>> map, String network) {
    Map<String, T> direct = map.get(network);
    if (direct != null) {
      return direct;
    }
    for (Map.Entry<String, ? extends Map<String, T>> e : map.entrySet()) {
      if (matchesPattern(e.getKey(), network)) {
        return e.getValue();
      }
    }
    return null;
  }

  /**
   * Looks up a value by scheme and network with pattern matching.
   *
   * @param map network (or pattern) → scheme → value
   * @param scheme the scheme
   * @param network the network
   * @param <T> the value type
   * @return the value, or {@code null}
   */
  public static <T> T findByNetworkAndScheme(
      Map<String, ? extends Map<String, T>> map, String scheme, String network) {
    Map<String, T> schemes = findSchemesByNetwork(map, network);
    return schemes == null ? null : schemes.get(scheme);
  }
}
