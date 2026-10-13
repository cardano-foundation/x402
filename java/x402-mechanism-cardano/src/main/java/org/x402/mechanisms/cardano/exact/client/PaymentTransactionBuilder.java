package org.x402.mechanisms.cardano.exact.client;

import com.bloxbean.cardano.client.crypto.Blake2bUtil;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.x402.mechanisms.cardano.CardanoAddresses;
import org.x402.mechanisms.cardano.CardanoUtils;
import org.x402.mechanisms.cardano.Cbor;
import org.x402.mechanisms.cardano.chain.ProtocolParameters;
import org.x402.mechanisms.cardano.chain.WalletUtxo;

/**
 * Builds, balances and signs a single-payment transaction, encoded exactly as Evolution (TS)
 * encodes it (decision 100; port of the Go branch's {@code txbuilder.go}): {@code [body,
 * witnessSet, true, null]}, body keys ascending, inputs as a sorted tag-258 set, outputs without
 * datum in the legacy array form and with an inline datum in the map form, one vkey witness in a
 * tag-258 set. The body carries only inputs, outputs, fee and TTL.
 */
public final class PaymentTransactionBuilder {

  private static final int MIN_UTXO_RAISE_ROUNDS = 4;
  private static final int FEE_ROUNDS = 8;
  private static final HexFormat HEX = HexFormat.of();

  private PaymentTransactionBuilder() {}

  /**
   * One transaction output.
   *
   * @param address bech32
   * @param coin lovelace
   * @param assets native assets ({@code policy.name} → quantity), may be empty
   * @param datum inline datum CBOR, or {@code null}
   */
  public record Output(String address, BigInteger coin, Map<String, BigInteger> assets, byte[] datum) {
    /** Copies the assets and datum. */
    public Output {
      assets = assets == null ? Map.of() : new LinkedHashMap<>(assets);
      datum = datum == null ? null : datum.clone();
    }

    @Override
    public byte[] datum() {
      return datum == null ? null : datum.clone();
    }
  }

  /**
   * The payment output.
   *
   * @param output the output
   * @param raiseToMinUtxo whether to lift the coin to the output's min-UTxO
   */
  public record Payment(Output output, boolean raiseToMinUtxo) {}

  /**
   * A payment transaction to build.
   *
   * @param utxos wallet UTxOs; the first is the nonce and always spent
   * @param changeAddress the change address
   * @param payment the payment output
   * @param ttlSlot the TTL
   * @param parameters live protocol parameters
   */
  public record Spec(
      List<WalletUtxo> utxos, String changeAddress, Payment payment, BigInteger ttlSlot, ProtocolParameters parameters) {
    /** Copies the UTxOs. */
    public Spec {
      utxos = List.copyOf(utxos);
    }
  }

  /** Signs a body hash. */
  @FunctionalInterface
  public interface BodySigner {
    /**
     * Signs.
     *
     * @param bodyHash blake2b-256 of the body
     * @return {@code {vkey, signature}}
     */
    byte[][] sign(byte[] bodyHash);
  }

  /**
   * A built, signed transaction.
   *
   * @param bytes the transaction CBOR
   * @param txHash the transaction id
   * @param fee the fee
   * @param nonce the nonce reference
   * @param inputs every spent reference
   */
  public record Built(byte[] bytes, String txHash, BigInteger fee, String nonce, List<String> inputs) {
    /** Copies. */
    public Built {
      bytes = bytes.clone();
      inputs = List.copyOf(inputs);
    }

    @Override
    public byte[] bytes() {
      return bytes.clone();
    }
  }

  /** Value accumulator. */
  private static final class Value {
    BigInteger coin = BigInteger.ZERO;
    final Map<String, BigInteger> assets = new TreeMap<>();

    void add(BigInteger c, Map<String, BigInteger> a) {
      coin = coin.add(c);
      a.forEach((unit, qty) -> assets.merge(unit, qty, BigInteger::add));
    }
  }

  /**
   * Selects inputs, balances fee and change, and signs.
   *
   * @param spec the transaction
   * @param signer the body signer
   * @return the built transaction
   * @throws IllegalStateException when funds are insufficient or the payment is below min-UTxO
   */
  public static Built build(Spec spec, BodySigner signer) {
    if (spec.utxos().isEmpty()) {
      throw new IllegalStateException("Funding wallet has no UTXOs available for the payment");
    }
    Output payment = spec.payment().output();
    for (int i = 0; ; i++) {
      BigInteger minimum =
          CardanoUtils.minUtxoLovelace(encodeOutput(payment).length, spec.parameters().coinsPerUtxoByte());
      if (payment.coin().compareTo(minimum) >= 0) {
        break;
      }
      if (!spec.payment().raiseToMinUtxo() || i == MIN_UTXO_RAISE_ROUNDS - 1) {
        throw new IllegalStateException(
            "payment of " + payment.coin() + " lovelace is below the min-UTxO of " + minimum);
      }
      payment = new Output(payment.address(), minimum, payment.assets(), payment.datum());
    }

    List<WalletUtxo> selected = new ArrayList<>(List.of(spec.utxos().get(0)));
    List<WalletUtxo> candidates = new ArrayList<>(spec.utxos().subList(1, spec.utxos().size()));
    candidates.removeIf(WalletUtxo::hasReferenceScript);
    candidates.sort(
        Comparator.comparing((WalletUtxo u) -> !u.assets().isEmpty()).thenComparing(WalletUtxo::coin, Comparator.reverseOrder()));
    while (true) {
      Attempt attempt = balance(spec, payment, selected, signer, false);
      if (attempt.built != null) {
        return attempt.built;
      }
      Value shortfall = attempt.shortfall;
      int next = -1;
      for (int i = 0; i < candidates.size(); i++) {
        if (shortfall.assets.isEmpty() || shortfall.assets.keySet().stream().anyMatch(candidates.get(i).assets()::containsKey)) {
          next = i;
          break;
        }
      }
      if (next < 0 && shortfall.assets.isEmpty()) {
        Attempt folded = balance(spec, payment, selected, signer, true);
        if (folded.built != null) {
          return folded.built;
        }
      }
      if (next < 0) {
        StringBuilder detail = new StringBuilder("insufficient funds: short " + shortfall.coin + " lovelace");
        if (!shortfall.assets.isEmpty()) {
          List<String> parts = new ArrayList<>();
          shortfall.assets.forEach((unit, qty) -> parts.add(qty + " " + unit));
          detail.append(" and ").append(String.join(", ", parts));
        }
        throw new IllegalStateException(detail.toString());
      }
      selected.add(candidates.remove(next));
    }
  }

  private record Attempt(Built built, Value shortfall) {}

  private static Attempt balance(Spec spec, Output payment, List<WalletUtxo> inputs, BodySigner signer, boolean noChange) {
    Value in = new Value();
    for (WalletUtxo u : inputs) {
      in.add(u.coin(), u.assets());
    }
    Value shortfall = new Value();
    if (in.coin.compareTo(payment.coin()) < 0) {
      shortfall.coin = payment.coin().subtract(in.coin);
    }
    payment.assets().forEach(
        (unit, qty) -> {
          BigInteger have = in.assets.getOrDefault(unit, BigInteger.ZERO);
          if (have.compareTo(qty) < 0) {
            shortfall.assets.put(unit, qty.subtract(have));
          }
        });
    if (shortfall.coin.signum() > 0 || !shortfall.assets.isEmpty()) {
      return new Attempt(null, shortfall);
    }
    Map<String, BigInteger> changeAssets = new TreeMap<>();
    in.assets.forEach(
        (unit, qty) -> {
          BigInteger rest = qty.subtract(payment.assets().getOrDefault(unit, BigInteger.ZERO));
          if (rest.signum() > 0) {
            changeAssets.put(unit, rest);
          }
        });
    BigInteger minFeeA = spec.parameters().minFeeCoefficient();
    BigInteger minFeeB = spec.parameters().minFeeConstant();
    if (noChange) {
      if (!changeAssets.isEmpty()) {
        return new Attempt(null, new Value());
      }
      BigInteger fee = in.coin.subtract(payment.coin());
      byte[][] assembled = assemble(spec, payment, inputs, null, fee, signer);
      BigInteger needed = minFeeA.multiply(BigInteger.valueOf(assembled[0].length)).add(minFeeB);
      if (needed.compareTo(fee) > 0) {
        Value s = new Value();
        s.coin = needed.subtract(fee);
        return new Attempt(null, s);
      }
      return new Attempt(finish(spec, inputs, assembled, fee), null);
    }
    BigInteger fee = BigInteger.ZERO;
    for (int i = 0; i < FEE_ROUNDS; i++) {
      BigInteger available = in.coin.subtract(payment.coin());
      if (available.compareTo(fee) < 0) {
        Value s = new Value();
        s.coin = fee.subtract(available);
        return new Attempt(null, s);
      }
      Output change = new Output(spec.changeAddress(), available.subtract(fee), changeAssets, null);
      BigInteger minChange = CardanoUtils.minUtxoLovelace(encodeOutput(change).length, spec.parameters().coinsPerUtxoByte());
      if (change.coin().compareTo(minChange) < 0) {
        Value s = new Value();
        s.coin = minChange.subtract(change.coin());
        return new Attempt(null, s);
      }
      byte[][] assembled = assemble(spec, payment, inputs, change, fee, signer);
      BigInteger needed = minFeeA.multiply(BigInteger.valueOf(assembled[0].length)).add(minFeeB);
      if (needed.compareTo(fee) <= 0) {
        return new Attempt(finish(spec, inputs, assembled, fee), null);
      }
      fee = needed;
    }
    throw new IllegalStateException("transaction fee did not converge");
  }

  private static Built finish(Spec spec, List<WalletUtxo> inputs, byte[][] assembled, BigInteger fee) {
    List<String> refs = new ArrayList<>();
    for (WalletUtxo u : inputs) {
      refs.add(u.ref());
    }
    return new Built(assembled[0], HEX.formatHex(assembled[1]), fee, spec.utxos().get(0).ref(), refs);
  }

  /** Returns {txBytes, bodyHash}. */
  private static byte[][] assemble(
      Spec spec, Output payment, List<WalletUtxo> inputs, Output change, BigInteger fee, BodySigner signer) {
    List<String> refs = new ArrayList<>();
    for (WalletUtxo u : inputs) {
      refs.add(u.ref());
    }
    List<Output> outputs = new ArrayList<>(List.of(payment));
    if (change != null) {
      outputs.add(change);
    }
    byte[] body = encodeBody(refs, outputs, fee, spec.ttlSlot());
    byte[] hash = Blake2bUtil.blake2bHash256(body);
    byte[][] witness = signer.sign(hash);
    return new byte[][] {envelope(body, witness[0], witness[1]), hash};
  }

  /**
   * Encodes a complete signed transaction in Evolution's form.
   *
   * @param inputRefs input references {@code txHash#index}
   * @param outputs the outputs in order
   * @param fee the fee
   * @param ttlSlot the TTL, or {@code null}
   * @param vkey the witness key
   * @param signature the witness signature
   * @return the transaction CBOR
   */
  public static byte[] encode(
      List<String> inputRefs, List<Output> outputs, BigInteger fee, BigInteger ttlSlot, byte[] vkey, byte[] signature) {
    return envelope(encodeBody(inputRefs, outputs, fee, ttlSlot), vkey, signature);
  }

  private static byte[] envelope(byte[] body, byte[] vkey, byte[] signature) {
    return new Cbor.Writer()
        .header(4, 4)
        .raw(body)
        .header(5, 1)
        .header(0, 0)
        .header(6, 258)
        .header(4, 1)
        .header(4, 2)
        .bytes(vkey)
        .bytes(signature)
        .raw(0xf5)
        .raw(0xf6)
        .toByteArray();
  }

  /**
   * Encodes a body with inputs, outputs, fee and optional TTL.
   *
   * @param inputRefs input references
   * @param outputs the outputs
   * @param fee the fee
   * @param ttlSlot the TTL, or {@code null}
   * @return the body CBOR
   */
  public static byte[] encodeBody(List<String> inputRefs, List<Output> outputs, BigInteger fee, BigInteger ttlSlot) {
    List<CardanoUtils.UtxoRef> sorted = new ArrayList<>();
    for (String ref : inputRefs) {
      sorted.add(CardanoUtils.parseUtxoRef(ref));
    }
    sorted.sort(Comparator.comparing(CardanoUtils.UtxoRef::txHash).thenComparing(CardanoUtils.UtxoRef::index));
    Cbor.Writer w = new Cbor.Writer().header(5, ttlSlot == null ? 3 : 4);
    w.header(0, 0).header(6, 258).header(4, sorted.size());
    for (CardanoUtils.UtxoRef ref : sorted) {
      w.header(4, 2).bytes(HEX.parseHex(ref.txHash())).header(0, ref.index());
    }
    w.header(0, 1).header(4, outputs.size());
    for (Output o : outputs) {
      w.raw(encodeOutput(o));
    }
    w.header(0, 2).header(0, fee);
    if (ttlSlot != null) {
      w.header(0, 3).header(0, ttlSlot);
    }
    return w.toByteArray();
  }

  /**
   * Encodes an output: legacy array without datum, map form with an inline datum.
   *
   * @param output the output
   * @return the output CBOR
   */
  public static byte[] encodeOutput(Output output) {
    byte[] address = CardanoAddresses.toBytes(output.address());
    Cbor.Writer w = new Cbor.Writer();
    byte[] datum = output.datum();
    if (datum == null) {
      w.header(4, 2).bytes(address);
      value(w, output.coin(), output.assets());
      return w.toByteArray();
    }
    w.header(5, 3).header(0, 0).bytes(address).header(0, 1);
    value(w, output.coin(), output.assets());
    w.header(0, 2).header(4, 2).header(0, 1).header(6, 24).bytes(datum);
    return w.toByteArray();
  }

  private static void value(Cbor.Writer w, BigInteger coin, Map<String, BigInteger> assets) {
    if (assets.isEmpty()) {
      w.header(0, coin);
      return;
    }
    Map<String, Map<String, BigInteger>> byPolicy = new TreeMap<>();
    assets.forEach(
        (unit, qty) -> {
          CardanoUtils.AssetUnit parsed = CardanoUtils.parseAssetUnit(unit);
          byPolicy.computeIfAbsent(parsed.policyId(), k -> new TreeMap<>(PaymentTransactionBuilder::compareNames))
              .put(parsed.assetNameHex(), qty);
        });
    w.header(4, 2).header(0, coin).header(5, byPolicy.size());
    byPolicy.forEach(
        (policy, names) -> {
          w.bytes(HEX.parseHex(policy)).header(5, names.size());
          names.forEach((name, qty) -> w.bytes(HEX.parseHex(name)).header(0, qty));
        });
  }

  /** CBOR core deterministic order of byte-string keys: shorter first, then bytewise. */
  private static int compareNames(String a, String b) {
    byte[] x = HEX.parseHex(a);
    byte[] y = HEX.parseHex(b);
    if (x.length != y.length) {
      return Integer.compare(x.length, y.length);
    }
    return Arrays.compareUnsigned(x, y);
  }
}
