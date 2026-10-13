package org.x402.mechanisms.cardano.chain;

import java.util.List;

/**
 * The chain reads a buyer wallet needs to build a payment (TS: the Evolution provider behind
 * {@code toClientCardanoSigner}). It never submits: the facilitator broadcasts during settle.
 */
public interface CardanoWalletProvider {

  /**
   * The unspent outputs at an address.
   *
   * @param address the wallet address
   * @param network the x402 network
   * @return the UTxOs (empty when the address has none)
   */
  List<WalletUtxo> getAddressUtxos(String address, String network);

  /**
   * Live protocol parameters (fee floor, min-UTxO).
   *
   * @param network the x402 network
   * @return the parameters
   */
  ProtocolParameters getProtocolParameters(String network);
}
