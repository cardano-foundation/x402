package org.x402.mechanisms.cardano.exact.facilitator;

import java.math.BigInteger;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.x402.mechanisms.cardano.CardanoErrors;
import org.x402.mechanisms.cardano.DecodedCardanoTransaction;
import org.x402.mechanisms.cardano.chain.ProtocolParameters;
import org.x402.mechanisms.cardano.chain.UtxoSnapshot;

/** Built-in phase-1 checks (TS {@code exact/facilitator/phase1.ts}), with TS's details. */
public final class Phase1Checks {

  private Phase1Checks() {}

  /**
   * A check outcome.
   *
   * @param ok whether it passed
   * @param reason the error code when failed
   * @param detail the detail when failed
   */
  public record Result(boolean ok, String reason, String detail) {
    /** Success. */
    public static final Result OK = new Result(true, null, null);
  }

  /**
   * Value conservation over authenticated input values: every lovelace and native asset of the
   * inputs reappears in the outputs plus the fee. Only for plain payments.
   *
   * @param decoded the transaction
   * @param inputs snapshots of every input, in input order
   * @return the outcome
   */
  public static Result checkValueConservation(DecodedCardanoTransaction decoded, List<UtxoSnapshot> inputs) {
    BigInteger inputCoin = BigInteger.ZERO;
    Map<String, BigInteger> inputAssets = new LinkedHashMap<>();
    for (int i = 0; i < inputs.size(); i++) {
      UtxoSnapshot snapshot = inputs.get(i);
      if (snapshot.coin() == null) {
        String ref = i < decoded.inputs().size() ? decoded.inputs().get(i) : String.valueOf(i);
        return new Result(
            false, CardanoErrors.INPUT_VALUE_UNAVAILABLE, "the chain layer reported no value for input " + ref);
      }
      inputCoin = inputCoin.add(snapshot.coin());
      if (snapshot.assets() != null) {
        snapshot.assets().forEach((unit, quantity) -> add(inputAssets, unit, quantity));
      }
    }
    BigInteger outputCoin = decoded.fee();
    Map<String, BigInteger> outputAssets = new LinkedHashMap<>();
    for (DecodedCardanoTransaction.Output output : decoded.outputs()) {
      outputCoin = outputCoin.add(output.coin());
      output.assets().forEach((unit, quantity) -> add(outputAssets, unit, quantity));
    }
    if (!inputCoin.equals(outputCoin)) {
      return new Result(
          false,
          CardanoErrors.VALUE_NOT_CONSERVED,
          "inputs carry " + inputCoin + " lovelace but outputs and fee total " + outputCoin);
    }
    Set<String> units = new LinkedHashSet<>(inputAssets.keySet());
    units.addAll(outputAssets.keySet());
    for (String unit : units) {
      BigInteger consumed = inputAssets.getOrDefault(unit, BigInteger.ZERO);
      BigInteger produced = outputAssets.getOrDefault(unit, BigInteger.ZERO);
      if (!consumed.equals(produced)) {
        return new Result(
            false,
            CardanoErrors.VALUE_NOT_CONSERVED,
            "inputs carry " + consumed + " of " + unit + " but outputs carry " + produced);
      }
    }
    return Result.OK;
  }

  /**
   * The fee floor {@code minFeeConstant + minFeeCoefficient * size}.
   *
   * @param decoded the transaction
   * @param parameters live protocol parameters
   * @return the outcome
   */
  public static Result checkMinimumFee(DecodedCardanoTransaction decoded, ProtocolParameters parameters) {
    BigInteger minimum =
        parameters.minFeeConstant().add(parameters.minFeeCoefficient().multiply(BigInteger.valueOf(decoded.sizeBytes())));
    if (decoded.fee().compareTo(minimum) < 0) {
      return new Result(
          false,
          CardanoErrors.FEE_BELOW_MINIMUM,
          "fee " + decoded.fee() + " is below the protocol minimum " + minimum + " for " + decoded.sizeBytes() + " bytes");
    }
    return Result.OK;
  }

  private static void add(Map<String, BigInteger> target, String unit, BigInteger quantity) {
    if (quantity.signum() == 0) {
      return;
    }
    target.merge(unit.toLowerCase(Locale.ROOT), quantity, BigInteger::add);
  }
}
