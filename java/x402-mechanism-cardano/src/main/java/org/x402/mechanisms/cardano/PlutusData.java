package org.x402.mechanisms.cardano;

import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

/**
 * Plutus {@code Data}: decoding from CBOR (any valid encoding) and encoding in the Aiken / Plutus
 * convention Evolution uses on chain (non-empty lists and maps indefinite-length, byte strings
 * over 64 bytes chunked, big integers as tagged byte strings, constructors as tags 121–127,
 * 1280–1400 or 102).
 */
public sealed interface PlutusData {

  /**
   * Encodes this value.
   *
   * @return the CBOR bytes
   */
  default byte[] toCbor() {
    Cbor.Writer w = new Cbor.Writer();
    encode(this, w);
    return w.toByteArray();
  }

  /**
   * A constructor application.
   *
   * @param index the constructor index
   * @param fields the fields
   */
  record Constr(BigInteger index, List<PlutusData> fields) implements PlutusData {
    /** Copies the fields. */
    public Constr {
      fields = List.copyOf(fields);
    }

    /**
     * A constructor with a small index.
     *
     * @param index the index
     * @param fields the fields
     * @return the constructor
     */
    public static Constr of(long index, PlutusData... fields) {
      return new Constr(BigInteger.valueOf(index), List.of(fields));
    }
  }

  /**
   * An integer.
   *
   * @param value the value
   */
  record IntData(BigInteger value) implements PlutusData {
    /**
     * An integer from a long.
     *
     * @param value the value
     * @return the data
     */
    public static IntData of(long value) {
      return new IntData(BigInteger.valueOf(value));
    }
  }

  /**
   * A byte string.
   *
   * @param bytes the bytes
   */
  record BytesData(byte[] bytes) implements PlutusData {
    /** Copies the bytes. */
    public BytesData {
      bytes = bytes.clone();
    }

    /**
     * A byte string from hex.
     *
     * @param hex lowercase or uppercase hex
     * @return the data
     */
    public static BytesData ofHex(String hex) {
      return new BytesData(HexFormat.of().parseHex(hex));
    }

    @Override
    public byte[] bytes() {
      return bytes.clone();
    }

    /**
     * The bytes as lowercase hex.
     *
     * @return the hex
     */
    public String hex() {
      return HexFormat.of().formatHex(bytes);
    }

    @Override
    public boolean equals(Object o) {
      return o instanceof BytesData other && Arrays.equals(bytes, other.bytes);
    }

    @Override
    public int hashCode() {
      return Arrays.hashCode(bytes);
    }

    @Override
    public String toString() {
      return "BytesData[" + hex() + "]";
    }
  }

  /**
   * A list.
   *
   * @param items the items
   */
  record ListData(List<PlutusData> items) implements PlutusData {
    /** Copies the items. */
    public ListData {
      items = List.copyOf(items);
    }
  }

  /**
   * A map, entries in order.
   *
   * @param entries the entries
   */
  record MapData(List<Map.Entry<PlutusData, PlutusData>> entries) implements PlutusData {
    /** Copies the entries. */
    public MapData {
      entries = List.copyOf(entries);
    }
  }

  /**
   * Decodes Plutus data from CBOR bytes.
   *
   * @param cbor the bytes
   * @return the data
   * @throws IllegalArgumentException when the bytes are not Plutus data
   */
  static PlutusData fromCbor(byte[] cbor) {
    return fromItem(Cbor.decode(cbor));
  }

  /**
   * Decodes Plutus data from a CBOR item.
   *
   * @param item the item
   * @return the data
   */
  static PlutusData fromItem(Cbor.Item item) {
    switch (item.major()) {
      case UNSIGNED:
      case NEGATIVE:
        return new IntData(item.integer());
      case BYTES:
        return new BytesData(item.bytes());
      case ARRAY:
        List<PlutusData> list = new ArrayList<>();
        for (Cbor.Item i : item.items()) {
          list.add(fromItem(i));
        }
        return new ListData(list);
      case MAP:
        List<Map.Entry<PlutusData, PlutusData>> entries = new ArrayList<>();
        for (Map.Entry<Cbor.Item, Cbor.Item> e : item.entries()) {
          entries.add(Map.entry(fromItem(e.getKey()), fromItem(e.getValue())));
        }
        return new MapData(entries);
      case TAG:
        return fromTag(item);
      default:
        throw new IllegalArgumentException("CBOR item is not Plutus data: " + item.major());
    }
  }

  private static PlutusData fromTag(Cbor.Item item) {
    long tag = item.integer().longValueExact();
    Cbor.Item inner = item.tagged();
    if (tag == 2 || tag == 3) {
      if (inner.major() != Cbor.Major.BYTES) {
        throw new IllegalArgumentException("bignum tag must wrap a byte string");
      }
      BigInteger magnitude = new BigInteger(1, inner.bytes());
      return new IntData(tag == 2 ? magnitude : magnitude.add(BigInteger.ONE).negate());
    }
    if (tag >= 121 && tag <= 127) {
      return new Constr(BigInteger.valueOf(tag - 121), fields(inner));
    }
    if (tag >= 1280 && tag <= 1400) {
      return new Constr(BigInteger.valueOf(tag - 1280 + 7), fields(inner));
    }
    if (tag == 102) {
      if (inner.major() != Cbor.Major.ARRAY
          || inner.items().size() != 2
          || inner.items().get(0).major() != Cbor.Major.UNSIGNED) {
        throw new IllegalArgumentException("general constructor must be [index, fields]");
      }
      return new Constr(inner.items().get(0).integer(), fields(inner.items().get(1)));
    }
    throw new IllegalArgumentException("unsupported Plutus data tag " + tag);
  }

  private static List<PlutusData> fields(Cbor.Item item) {
    if (item.major() != Cbor.Major.ARRAY) {
      throw new IllegalArgumentException("constructor fields must be an array");
    }
    List<PlutusData> result = new ArrayList<>();
    for (Cbor.Item i : item.items()) {
      result.add(fromItem(i));
    }
    return result;
  }

  /**
   * Encodes a value in the Aiken / Evolution convention.
   *
   * @param data the value
   * @param w the writer
   */
  private static void encode(PlutusData data, Cbor.Writer w) {
    if (data instanceof IntData i) {
      encodeInt(i.value(), w);
    } else if (data instanceof BytesData b) {
      encodeBytes(b.bytes, w);
    } else if (data instanceof ListData l) {
      encodeList(l.items(), w);
    } else if (data instanceof MapData m) {
      if (m.entries().isEmpty()) {
        w.raw(0xa0);
      } else {
        w.raw(0xbf);
        for (Map.Entry<PlutusData, PlutusData> e : m.entries()) {
          encode(e.getKey(), w);
          encode(e.getValue(), w);
        }
        w.raw(0xff);
      }
    } else {
      Constr c = (Constr) data;
      BigInteger index = c.index();
      if (index.signum() >= 0 && index.compareTo(BigInteger.valueOf(7)) < 0) {
        w.header(6, 121 + index.longValue());
        encodeList(c.fields(), w);
      } else if (index.signum() >= 0 && index.compareTo(BigInteger.valueOf(128)) < 0) {
        w.header(6, 1280 + index.longValue() - 7);
        encodeList(c.fields(), w);
      } else {
        w.header(6, 102);
        w.header(4, 2);
        encodeInt(index, w);
        encodeList(c.fields(), w);
      }
    }
  }

  private static void encodeList(List<PlutusData> items, Cbor.Writer w) {
    if (items.isEmpty()) {
      w.raw(0x80);
      return;
    }
    w.raw(0x9f);
    for (PlutusData item : items) {
      encode(item, w);
    }
    w.raw(0xff);
  }

  private static void encodeInt(BigInteger value, Cbor.Writer w) {
    if (value.signum() >= 0 && value.bitLength() <= 64) {
      w.header(0, value);
    } else if (value.signum() < 0 && value.negate().subtract(BigInteger.ONE).bitLength() <= 64) {
      w.header(1, value.negate().subtract(BigInteger.ONE));
    } else if (value.signum() >= 0) {
      w.header(6, 2);
      encodeBytes(magnitude(value), w);
    } else {
      w.header(6, 3);
      encodeBytes(magnitude(value.negate().subtract(BigInteger.ONE)), w);
    }
  }

  private static byte[] magnitude(BigInteger value) {
    byte[] raw = value.toByteArray();
    return raw.length > 1 && raw[0] == 0 ? Arrays.copyOfRange(raw, 1, raw.length) : raw;
  }

  private static void encodeBytes(byte[] bytes, Cbor.Writer w) {
    if (bytes.length <= 64) {
      w.bytes(bytes);
      return;
    }
    w.raw(0x5f);
    for (int offset = 0; offset < bytes.length; offset += 64) {
      w.bytes(Arrays.copyOfRange(bytes, offset, Math.min(bytes.length, offset + 64)));
    }
    w.raw(0xff);
  }
}
