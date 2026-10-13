package org.x402.mechanisms.cardano.testing;

import java.math.BigInteger;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.x402.mechanisms.cardano.chain.CardanoWalletProvider;
import org.x402.mechanisms.cardano.chain.ProtocolParameters;
import org.x402.mechanisms.cardano.chain.UtxoSnapshot;
import org.x402.mechanisms.cardano.chain.WalletUtxo;

/** A wallet provider serving fixed UTxOs and counting every call. */
public final class StubWallet implements CardanoWalletProvider {

  /** UTxOs served for any address. */
  public final List<WalletUtxo> utxos = new ArrayList<>();
  /** Calls to {@link #getAddressUtxos}. */
  public final AtomicInteger utxoCalls = new AtomicInteger();
  /** Calls to {@link #getProtocolParameters}. */
  public final AtomicInteger parameterCalls = new AtomicInteger();
  /** Served parameters. */
  public ProtocolParameters parameters =
      new ProtocolParameters(BigInteger.valueOf(4310), BigInteger.valueOf(44), BigInteger.valueOf(155381));

  /**
   * Adds a UTxO.
   *
   * @param txHash the producing transaction
   * @param index the index
   * @param address the owner
   * @param coin lovelace
   * @param assets native assets
   * @return this wallet
   */
  public StubWallet utxo(String txHash, long index, String address, long coin, Map<String, BigInteger> assets) {
    utxos.add(new WalletUtxo(txHash, index, address, BigInteger.valueOf(coin), assets, false));
    return this;
  }

  /**
   * Total calls of any kind.
   *
   * @return the count
   */
  public int calls() {
    return utxoCalls.get() + parameterCalls.get();
  }

  /**
   * Copies the UTxOs into a facilitator stub as unspent inputs.
   *
   * @param backend the facilitator stub
   */
  public void publishTo(StubBackend backend) {
    for (WalletUtxo u : utxos) {
      backend.utxos.put(
          u.ref(), new UtxoSnapshot(true, u.address(), u.coin(), u.assets(), null));
    }
  }

  @Override
  public List<WalletUtxo> getAddressUtxos(String address, String network) {
    utxoCalls.incrementAndGet();
    return List.copyOf(utxos);
  }

  @Override
  public ProtocolParameters getProtocolParameters(String network) {
    parameterCalls.incrementAndGet();
    return parameters;
  }
}
