package org.x402.mechanisms.cardano.chain;

import java.math.BigInteger;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * One unspent output of a buyer wallet.
 *
 * @param txHash lowercase producing transaction id
 * @param index output index
 * @param address the owner address
 * @param coin lovelace
 * @param assets native assets keyed by lowercase {@code policy.assetNameHex}
 * @param hasReferenceScript whether the output carries a reference script (never selected)
 */
public record WalletUtxo(
    String txHash, long index, String address, BigInteger coin, Map<String, BigInteger> assets, boolean hasReferenceScript) {

  /** Copies the assets. */
  public WalletUtxo {
    assets = assets == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(assets));
  }

  /**
   * The reference {@code txHash#index}.
   *
   * @return the reference
   */
  public String ref() {
    return txHash + "#" + index;
  }
}
