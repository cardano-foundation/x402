package org.x402.mechanisms.cardano.exact.script;

import com.bloxbean.cardano.client.crypto.Blake2bUtil;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.x402.mechanisms.cardano.CardanoAddresses;
import org.x402.mechanisms.cardano.CardanoConstants;
import org.x402.mechanisms.cardano.Cbor;
import org.x402.mechanisms.cardano.PlutusData;

/**
 * Reconstructs the script credential a {@code script} extra declares and checks it against
 * {@code payTo} (TS {@code exact/facilitator/scriptAddress.ts}), with TS's error messages.
 */
public final class ScriptAddresses {

  private static final Pattern SCRIPT_HASH = Pattern.compile("^[0-9a-f]{56}$");
  private static final Pattern EVEN_HEX = Pattern.compile("^(?:[0-9a-f]{2})+$");
  private static final Pattern HEX_OR_EMPTY = Pattern.compile("^(?:[0-9a-f]{2})*$");
  private static final Pattern CANONICAL_INTEGER = Pattern.compile("^(?:0|[1-9]\\d*|-[1-9]\\d*)$");
  private static final BigInteger MAX_SAFE = BigInteger.valueOf(9_007_199_254_740_991L);
  private static final BigInteger ARRAY_INDEX_MAX = BigInteger.valueOf(4_294_967_294L);

  private ScriptAddresses() {}

  /**
   * Whether {@code payTo} is a script address whose credential equals the script hash derived
   * from the extra block.
   *
   * @param extra the requirements' {@code extra}
   * @param payTo the recipient address
   * @return true when they match
   */
  public static boolean scriptAddressMatches(Map<String, ?> extra, String payTo) {
    String credential = CardanoAddresses.scriptPaymentCredentialHex(payTo);
    if (credential == null) {
      return false;
    }
    try {
      return credential.equals(deriveScriptHashHex(extra));
    } catch (RuntimeException e) {
      return false;
    }
  }

  /**
   * Derives the script hash a {@code script} extra declares: from {@code script.code} plus
   * parameters when present, else from {@code scriptHash}.
   *
   * @param extra the extra block
   * @return lowercase hex script hash
   * @throws IllegalArgumentException with TS's messages when neither is usable
   */
  public static String deriveScriptHashHex(Map<String, ?> extra) {
    Object script = extra.get("script");
    Object code = script instanceof Map<?, ?> s ? s.get("code") : null;
    if (truthy(code)) {
      String codeText = String.valueOf(code);
      if (!(code instanceof String)
          || !EVEN_HEX.matcher(codeText).matches()
          || codeText.length() / 2 > CardanoConstants.MAX_SCRIPT_BYTES) {
        throw new IllegalArgumentException("Cardano script code is invalid or exceeds the byte limit");
      }
      List<Map.Entry<String, Object>> entries = jsObjectEntries(extra.get("parameters"));
      if (entries.size() > CardanoConstants.MAX_SCRIPT_PARAMETERS) {
        throw new IllegalArgumentException("Cardano script has too many parameters");
      }
      long parameterBytes = 0;
      List<PlutusData> params = new ArrayList<>();
      for (Map.Entry<String, Object> entry : entries) {
        parameterBytes +=
            entry.getKey().getBytes(StandardCharsets.UTF_8).length + parameterInputBytes(entry.getValue());
        if (parameterBytes > CardanoConstants.MAX_SCRIPT_PARAMETER_BYTES) {
          throw new IllegalArgumentException("Cardano script parameters exceed the byte limit");
        }
        params.add(toPlutusData(entry.getValue()));
      }
      byte[] applied = FlatApplier.applyParams(HexFormat.of().parseHex(codeText), params);
      byte[] scriptBytes = applied;
      Object type = ((Map<?, ?>) script).get("type");
      return HexFormat.of().formatHex(scriptHash(String.valueOf(type), scriptBytes));
    }
    Object scriptHash = extra.get("scriptHash");
    if (truthy(scriptHash)) {
      if (!(scriptHash instanceof String hash) || !SCRIPT_HASH.matcher(hash).matches()) {
        throw new IllegalArgumentException("Cardano scriptHash must be 28-byte lowercase hex");
      }
      return hash;
    }
    throw new IllegalArgumentException("Cardano script payment requires either `script` or `scriptHash`");
  }

  /**
   * The ledger script hash: blake2b-224 of the language tag and the script bytes (one CBOR
   * byte-string wrapper around the flat program).
   *
   * @param type {@code plutusV1}, {@code plutusV2} or {@code plutusV3}
   * @param scriptBytes the script bytes
   * @return the 28-byte hash
   */
  public static byte[] scriptHash(String type, byte[] scriptBytes) {
    int tag;
    switch (type) {
      case "plutusV1":
        tag = 1;
        break;
      case "plutusV2":
        tag = 2;
        break;
      case "plutusV3":
        tag = 3;
        break;
      default:
        throw new IllegalArgumentException("Unsupported Cardano script type: " + type);
    }
    byte[] input = new byte[scriptBytes.length + 1];
    input[0] = (byte) tag;
    System.arraycopy(scriptBytes, 0, input, 1, scriptBytes.length);
    return Blake2bUtil.blake2bHash224(input);
  }

  /**
   * Strips one CBOR byte-string wrapper (TS {@code unwrapCborByteString}).
   *
   * @param wrapped the wrapped bytes
   * @return the content
   */
  public static byte[] unwrapCborByteString(byte[] wrapped) {
    Cbor.Item item = Cbor.decode(wrapped);
    if (item.major() != Cbor.Major.BYTES) {
      throw new IllegalArgumentException("Expected a CBOR byte string");
    }
    return item.bytes();
  }

  private static boolean truthy(Object value) {
    if (value == null || Boolean.FALSE.equals(value)) {
      return false;
    }
    if (value instanceof String s) {
      return !s.isEmpty();
    }
    if (value instanceof Number n) {
      return n.doubleValue() != 0 && !Double.isNaN(n.doubleValue());
    }
    return true;
  }

  /** {@code Object.entries} order: integer-like keys ascending, then insertion order. */
  private static List<Map.Entry<String, Object>> jsObjectEntries(Object parameters) {
    List<Map.Entry<String, Object>> indexed = new ArrayList<>();
    List<Map.Entry<String, Object>> named = new ArrayList<>();
    if (parameters instanceof Map<?, ?> map) {
      for (Map.Entry<?, ?> e : map.entrySet()) {
        String key = String.valueOf(e.getKey());
        Map.Entry<String, Object> entry = new java.util.AbstractMap.SimpleImmutableEntry<>(key, e.getValue());
        if (isArrayIndex(key)) {
          indexed.add(entry);
        } else {
          named.add(entry);
        }
      }
    } else if (parameters instanceof List<?> list) {
      for (int i = 0; i < list.size(); i++) {
        indexed.add(new java.util.AbstractMap.SimpleImmutableEntry<>(String.valueOf(i), list.get(i)));
      }
    } else if (parameters instanceof String s) {
      for (int i = 0; i < s.length(); i++) {
        indexed.add(new java.util.AbstractMap.SimpleImmutableEntry<>(String.valueOf(i), String.valueOf(s.charAt(i))));
      }
    }
    indexed.sort((a, b) -> new BigInteger(a.getKey()).compareTo(new BigInteger(b.getKey())));
    List<Map.Entry<String, Object>> result = new ArrayList<>(indexed);
    result.addAll(named);
    return result;
  }

  private static boolean isArrayIndex(String key) {
    if (key.isEmpty() || !key.chars().allMatch(Character::isDigit) || (key.length() > 1 && key.charAt(0) == '0')) {
      return false;
    }
    return key.length() <= 10 && new BigInteger(key).compareTo(ARRAY_INDEX_MAX) <= 0;
  }

  private static String typeOf(Object param) {
    Object type = param instanceof Map<?, ?> m ? m.get("type") : null;
    return type == null ? (param instanceof Map<?, ?> m && m.containsKey("type") ? "null" : "undefined") : String.valueOf(type);
  }

  private static long parameterInputBytes(Object param) {
    if (!(param instanceof Map<?, ?>) && !(param instanceof List<?>)) {
      throw new IllegalArgumentException("Cardano script parameter must be an object");
    }
    Object value = param instanceof Map<?, ?> m ? m.get("value") : null;
    String type = typeOf(param);
    switch (type) {
      case "bytes":
        if (!(value instanceof String hex) || !HEX_OR_EMPTY.matcher(hex).matches()) {
          throw new IllegalArgumentException("Cardano bytes parameter must be lowercase even-length hex");
        }
        return hex.length() / 2;
      case "string":
        if (!(value instanceof String s)) {
          throw new IllegalArgumentException("Cardano string parameter must carry a string");
        }
        return s.getBytes(StandardCharsets.UTF_8).length;
      case "bigint":
      case "integer":
        String digits = integerText(value).replaceFirst("^-", "");
        if (digits.length() > 128) {
          throw new IllegalArgumentException("Cardano integer parameter exceeds the digit limit");
        }
        return digits.length();
      case "boolean":
        if (!(value instanceof Boolean)) {
          throw new IllegalArgumentException("Cardano boolean parameter must carry a boolean");
        }
        return 1;
      default:
        throw new IllegalArgumentException("Unsupported Cardano script parameter type: " + type);
    }
  }

  /** The decimal text of an integer parameter, validated the way TS validates it. */
  private static String integerText(Object value) {
    if (value instanceof Number n) {
      BigDecimal decimal = n instanceof BigInteger bi ? new BigDecimal(bi) : new BigDecimal(n.toString());
      BigInteger integral;
      try {
        integral = decimal.stripTrailingZeros().toBigIntegerExact();
      } catch (ArithmeticException e) {
        throw new IllegalArgumentException("Cardano integer parameter must be a safe integer");
      }
      if (integral.abs().compareTo(MAX_SAFE) > 0) {
        throw new IllegalArgumentException("Cardano integer parameter must be a safe integer");
      }
      return integral.toString();
    }
    if (!(value instanceof String s) || !CANONICAL_INTEGER.matcher(s).matches()) {
      throw new IllegalArgumentException("Cardano integer parameter must use canonical decimal syntax");
    }
    return s;
  }

  private static PlutusData toPlutusData(Object param) {
    Map<?, ?> m = (Map<?, ?>) param;
    Object value = m.get("value");
    switch (typeOf(param)) {
      case "bytes":
        return PlutusData.BytesData.ofHex((String) value);
      case "string":
        return new PlutusData.BytesData(((String) value).getBytes(StandardCharsets.UTF_8));
      case "bigint":
      case "integer":
        return new PlutusData.IntData(new BigInteger(integerText(value)));
      default: // boolean (other types were refused by parameterInputBytes)
        return PlutusData.Constr.of(Boolean.TRUE.equals(value) ? 1 : 0);
    }
  }
}
