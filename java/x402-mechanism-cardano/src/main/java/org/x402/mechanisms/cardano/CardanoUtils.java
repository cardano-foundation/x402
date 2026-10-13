package org.x402.mechanisms.cardano;

import java.math.BigInteger;
import java.util.Locale;
import java.util.Map;

/** Small helpers shared by client, server and facilitator (TS {@code utils.ts}). */
public final class CardanoUtils {

  private CardanoUtils() {}

  /**
   * A parsed UTxO reference.
   *
   * @param txHash lowercase transaction hash
   * @param index output index
   */
  public record UtxoRef(String txHash, BigInteger index) {

    /**
     * The canonical {@code txHash#index} form.
     *
     * @return the reference
     */
    @Override
    public String toString() {
      return txHash + "#" + index;
    }
  }

  /**
   * A parsed asset unit.
   *
   * @param policyId lowercase policy id, empty for lovelace
   * @param assetNameHex lowercase asset name, empty for lovelace
   */
  public record AssetUnit(String policyId, String assetNameHex) {}

  /**
   * The {@code transaction} and {@code nonce} of a Cardano payload.
   *
   * @param transaction base64 signed transaction
   * @param nonce UTxO reference
   */
  public record ExactCardanoPayload(String transaction, String nonce) {}

  /**
   * Parses {@code txHashHex#index}.
   *
   * @param ref the reference
   * @return the parsed reference
   * @throws IllegalArgumentException when malformed
   */
  public static UtxoRef parseUtxoRef(String ref) {
    if (ref == null || !CardanoConstants.UTXO_REF.matcher(ref).matches()) {
      throw new IllegalArgumentException("Invalid Cardano UTXO reference: " + ref);
    }
    int hash = ref.indexOf('#');
    return new UtxoRef(ref.substring(0, hash).toLowerCase(Locale.ROOT), new BigInteger(ref.substring(hash + 1)));
  }

  /**
   * Splits {@code policyId.assetNameHex}; lovelace yields empty parts.
   *
   * @param asset the unit
   * @return the parts
   * @throws IllegalArgumentException when malformed
   */
  public static AssetUnit parseAssetUnit(String asset) {
    if (asset == null || !CardanoConstants.ASSET.matcher(asset).matches()) {
      throw new IllegalArgumentException("Invalid Cardano asset unit: " + asset);
    }
    if (asset.equalsIgnoreCase(CardanoConstants.LOVELACE)) {
      return new AssetUnit("", "");
    }
    int dot = asset.indexOf('.');
    return new AssetUnit(
        asset.substring(0, dot).toLowerCase(Locale.ROOT), asset.substring(dot + 1).toLowerCase(Locale.ROOT));
  }

  /**
   * Protocol minimum lovelace for an output of a serialized size: {@code (160 + size) *
   * coinsPerUtxoByte}.
   *
   * @param serializedSize the output's byte length
   * @param coinsPerUtxoByte the protocol parameter
   * @return the minimum
   */
  public static BigInteger minUtxoLovelace(int serializedSize, BigInteger coinsPerUtxoByte) {
    return BigInteger.valueOf(CardanoConstants.MIN_UTXO_OVERHEAD_BYTES + (long) serializedSize)
        .multiply(coinsPerUtxoByte);
  }

  /**
   * Reads {@code transaction} and {@code nonce} out of a payload map; other keys are ignored.
   *
   * @param raw the payload map
   * @return the typed payload
   * @throws IllegalArgumentException with TS's messages when a field is missing or too large
   */
  public static ExactCardanoPayload decodePayload(Map<String, ?> raw) {
    Object transaction = raw == null ? null : raw.get("transaction");
    Object nonce = raw == null ? null : raw.get("nonce");
    if (!(transaction instanceof String tx) || tx.isEmpty()) {
      throw new IllegalArgumentException("Cardano payload is missing a transaction string");
    }
    if (tx.length() > CardanoTransactionDecoder.maxBase64Length()) {
      throw new IllegalArgumentException("Cardano payload transaction exceeds the decode limit");
    }
    if (!(nonce instanceof String n) || n.isEmpty()) {
      throw new IllegalArgumentException("Cardano payload is missing a nonce string");
    }
    return new ExactCardanoPayload(tx, n);
  }
}
