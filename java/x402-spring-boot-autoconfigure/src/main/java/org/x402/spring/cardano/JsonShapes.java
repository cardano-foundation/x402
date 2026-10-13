package org.x402.spring.cardano;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.x402.mechanisms.cardano.exact.masumi.MasumiDeployment;

/**
 * Restores JSON shapes from Spring's binding of {@code Map<String, Object>} values: lists arrive
 * as maps keyed {@code "0"}, {@code "1"}, … and numbers as strings.
 */
final class JsonShapes {

  private JsonShapes() {}

  /** Maps keyed by consecutive indices become lists, recursively. */
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

  /** A deployment declared in {@code extra.deployment}, or {@code null}. */
  @SuppressWarnings("unchecked")
  static MasumiDeployment deployment(Object raw) {
    Object restored = restore(raw);
    if (!(restored instanceof Map<?, ?> map)) {
      throw new IllegalArgumentException("extra.deployment must be an object {requiredAdmins, "
          + "adminVkeys, cooldownPeriod}; got " + raw);
    }
    Object admins = map.get("adminVkeys");
    if (!(admins instanceof List<?>) || !(map.get("requiredAdmins") instanceof String)
        || !(map.get("cooldownPeriod") instanceof String)) {
      throw new IllegalArgumentException("extra.deployment needs requiredAdmins, adminVkeys "
          + "and cooldownPeriod");
    }
    return MasumiDeployment.fromJson((Map<String, ?>) map);
  }

  /** {@code confirmationPolicy.l1Confirmations} as an integer, or {@code null} if malformed. */
  static Integer l1Confirmations(Object policy) {
    if (!(policy instanceof Map<?, ?> map) || map.size() != 1) {
      return null;
    }
    Object value = map.get("l1Confirmations");
    if (value instanceof Integer i) {
      return i;
    }
    if (value instanceof String s && s.matches("-?\\d{1,3}")) {
      return Integer.valueOf(s);
    }
    return null;
  }
}
