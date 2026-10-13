package org.x402.mechanisms.cardano;

import java.math.BigInteger;
import java.util.List;
import java.util.Map;

/**
 * The structural view of a signed transaction that verification needs (TS {@code
 * DecodedCardanoTransaction}).
 *
 * @param txHash lowercase hex blake2b-256 of the body's wire bytes
 * @param networkId body {@code network_id}, or {@code null} when absent
 * @param ttlSlot TTL slot, or {@code null} when absent
 * @param validityStartSlot validity start slot, or {@code null} when absent
 * @param inputs inputs as lowercase {@code txHash#index}, in body order
 * @param fee the fee in lovelace
 * @param sizeBytes byte length of the complete signed transaction
 * @param balanceChangingOperations body fields that move value outside inputs and outputs
 * @param outputs outputs in body order
 * @param vkeyWitnessCount vkey plus bootstrap witnesses
 * @param vkeyHashes blake2b-224 of each vkey witness key
 * @param scriptWitnessCount native and Plutus scripts plus redeemers
 * @param redeemerCount Plutus redeemers
 * @param signaturesValid whether every vkey witness verifies over the body hash
 * @param isValid the ledger {@code is_valid} flag
 */
public record DecodedCardanoTransaction(
    String txHash,
    Integer networkId,
    BigInteger ttlSlot,
    BigInteger validityStartSlot,
    List<String> inputs,
    BigInteger fee,
    int sizeBytes,
    List<String> balanceChangingOperations,
    List<Output> outputs,
    int vkeyWitnessCount,
    List<String> vkeyHashes,
    int scriptWitnessCount,
    int redeemerCount,
    boolean signaturesValid,
    boolean isValid) {

  /** Copies the lists. */
  public DecodedCardanoTransaction {
    inputs = List.copyOf(inputs);
    balanceChangingOperations = List.copyOf(balanceChangingOperations);
    outputs = List.copyOf(outputs);
    vkeyHashes = List.copyOf(vkeyHashes);
  }

  /**
   * One transaction output.
   *
   * @param address bech32 address
   * @param coin lovelace
   * @param assets native assets keyed by lowercase {@code policy.assetNameHex}
   * @param datum lowercase CBOR hex of an inline datum (wire bytes), else {@code null}
   * @param serializedSize byte length of the output's wire encoding
   * @param hasReferenceScript whether the output carries a reference script
   */
  public record Output(
      String address,
      BigInteger coin,
      Map<String, BigInteger> assets,
      String datum,
      int serializedSize,
      boolean hasReferenceScript) {

    /** Copies the asset map. */
    public Output {
      assets = java.util.Collections.unmodifiableMap(new java.util.LinkedHashMap<>(assets));
    }
  }
}
