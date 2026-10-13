package org.x402.mechanisms.cardano.exact.masumi;

import java.math.BigInteger;
import java.util.List;
import java.util.Objects;
import org.x402.mechanisms.cardano.CardanoAddresses;
import org.x402.mechanisms.cardano.CardanoAddresses.Credential;
import org.x402.mechanisms.cardano.CardanoAddresses.Pointer;
import org.x402.mechanisms.cardano.PlutusData;
import org.x402.mechanisms.cardano.PlutusData.BytesData;
import org.x402.mechanisms.cardano.PlutusData.Constr;
import org.x402.mechanisms.cardano.PlutusData.IntData;

/**
 * Codec for the Masumi {@code vested_pay} lock datum (TS {@code exact/masumi/datum.ts}): the
 * 19-field {@code Constr 0} built for a fresh lock and parsed back for verification.
 */
public final class MasumiDatum {

  /** The state constructor index of a fresh lock. */
  public static final BigInteger STATE_FUNDS_LOCKED = BigInteger.ZERO;

  private static final int CREDENTIAL_HASH_HEX_LENGTH = 56;

  private MasumiDatum() {}

  /**
   * An address split into payment and optional stake credential or pointer.
   *
   * @param payment the payment credential
   * @param stake the stake credential, or {@code null}
   * @param pointer the pointer, or {@code null}
   */
  public record AddressCredentials(Credential payment, Credential stake, Pointer pointer) {}

  /**
   * The decoded lock datum.
   *
   * @param buyer buyer address
   * @param buyerReturnAddress {@code Some} address, or {@code null} for {@code None}
   * @param seller seller address
   * @param sellerReturnAddress {@code Some} address, or {@code null} for {@code None}
   * @param referenceKey lowercase hex
   * @param referenceSignature lowercase hex
   * @param sellerNonce lowercase hex
   * @param buyerNonce lowercase hex
   * @param agentIdentifier lowercase hex
   * @param collateralReturnLovelace collateral
   * @param inputHash lowercase hex
   * @param resultHash lowercase hex
   * @param payByTime POSIX ms
   * @param submitResultTime POSIX ms
   * @param unlockTime POSIX ms
   * @param externalDisputeUnlockTime POSIX ms
   * @param sellerCooldownTime POSIX ms
   * @param buyerCooldownTime POSIX ms
   * @param state the state constructor index
   */
  public record View(
      AddressCredentials buyer,
      AddressCredentials buyerReturnAddress,
      AddressCredentials seller,
      AddressCredentials sellerReturnAddress,
      String referenceKey,
      String referenceSignature,
      String sellerNonce,
      String buyerNonce,
      String agentIdentifier,
      BigInteger collateralReturnLovelace,
      String inputHash,
      String resultHash,
      BigInteger payByTime,
      BigInteger submitResultTime,
      BigInteger unlockTime,
      BigInteger externalDisputeUnlockTime,
      BigInteger sellerCooldownTime,
      BigInteger buyerCooldownTime,
      BigInteger state) {}

  /**
   * The inputs of a fresh lock datum.
   *
   * @param buyerAddress buyer
   * @param sellerAddress seller
   * @param buyerReturnAddress optional buyer payout address, or {@code null}
   * @param sellerReturnAddress optional seller payout address, or {@code null}
   * @param referenceKey COSE_Key hex
   * @param referenceSignature COSE_Sign1 hex
   * @param sellerNonce hex
   * @param buyerNonce hex
   * @param agentIdentifier hex, possibly empty
   * @param collateralReturnLovelace the collateral
   * @param inputHash hex
   * @param payByTime POSIX ms
   * @param submitResultTime POSIX ms
   * @param unlockTime POSIX ms
   * @param externalDisputeUnlockTime POSIX ms
   */
  public record LockInput(
      String buyerAddress,
      String sellerAddress,
      String buyerReturnAddress,
      String sellerReturnAddress,
      String referenceKey,
      String referenceSignature,
      String sellerNonce,
      String buyerNonce,
      String agentIdentifier,
      BigInteger collateralReturnLovelace,
      String inputHash,
      BigInteger payByTime,
      BigInteger submitResultTime,
      BigInteger unlockTime,
      BigInteger externalDisputeUnlockTime) {}

  /**
   * The payment and stake credentials of a bech32 address (base, enterprise or pointer).
   *
   * @param bech32 the address
   * @return the credentials
   * @throws IllegalArgumentException for other address forms
   */
  public static AddressCredentials addressCredentials(String bech32) {
    CardanoAddresses.Parsed p = CardanoAddresses.parse(bech32);
    return new AddressCredentials(p.payment(), p.stake(), p.pointer());
  }

  /**
   * Whether two addresses share payment, stake and pointer parts.
   *
   * @param a the first
   * @param b the second
   * @return true when equal
   */
  public static boolean sameCredentials(AddressCredentials a, AddressCredentials b) {
    if (!a.payment().hash().equals(b.payment().hash()) || a.payment().isScript() != b.payment().isScript()) {
      return false;
    }
    String aStake = a.stake() == null ? "" : a.stake().hash();
    String bStake = b.stake() == null ? "" : b.stake().hash();
    boolean aStakeScript = a.stake() != null && a.stake().isScript();
    boolean bStakeScript = b.stake() != null && b.stake().isScript();
    if (!aStake.equals(bStake) || aStakeScript != bStakeScript) {
      return false;
    }
    return Objects.equals(pointerParts(a.pointer()), pointerParts(b.pointer()));
  }

  private static List<BigInteger> pointerParts(Pointer p) {
    BigInteger none = BigInteger.ONE.negate();
    return p == null ? List.of(none, none, none) : List.of(p.slot(), p.txIndex(), p.certIndex());
  }

  // ---------------------------------------------------------------- build

  private static PlutusData credentialToData(Credential c) {
    return Constr.of(c.isScript() ? 1 : 0, BytesData.ofHex(c.hash()));
  }

  private static PlutusData addressToData(String bech32) {
    AddressCredentials creds = addressCredentials(bech32);
    PlutusData stake;
    if (creds.stake() != null) {
      stake = Constr.of(0, Constr.of(0, credentialToData(creds.stake())));
    } else if (creds.pointer() != null) {
      stake =
          Constr.of(
              0,
              Constr.of(
                  1,
                  new IntData(creds.pointer().slot()),
                  new IntData(creds.pointer().txIndex()),
                  new IntData(creds.pointer().certIndex())));
    } else {
      stake = Constr.of(1);
    }
    return Constr.of(0, credentialToData(creds.payment()), stake);
  }

  private static PlutusData optionAddress(String bech32) {
    return bech32 == null || bech32.isEmpty() ? Constr.of(1) : Constr.of(0, addressToData(bech32));
  }

  /**
   * Builds the 19-field lock datum of a fresh lock.
   *
   * @param input the field values
   * @return the datum
   */
  public static PlutusData build(LockInput input) {
    return Constr.of(
        0,
        addressToData(input.buyerAddress()),
        optionAddress(input.buyerReturnAddress()),
        addressToData(input.sellerAddress()),
        optionAddress(input.sellerReturnAddress()),
        BytesData.ofHex(input.referenceKey()),
        BytesData.ofHex(input.referenceSignature()),
        BytesData.ofHex(input.sellerNonce()),
        BytesData.ofHex(input.buyerNonce()),
        BytesData.ofHex(input.agentIdentifier()),
        new IntData(input.collateralReturnLovelace()),
        BytesData.ofHex(input.inputHash()),
        BytesData.ofHex(""),
        new IntData(input.payByTime()),
        new IntData(input.submitResultTime()),
        new IntData(input.unlockTime()),
        new IntData(input.externalDisputeUnlockTime()),
        IntData.of(0),
        IntData.of(0),
        Constr.of(0));
  }

  // ---------------------------------------------------------------- parse

  private static Constr constr(PlutusData d) {
    return d instanceof Constr c ? c : null;
  }

  private static BigInteger integer(PlutusData d) {
    return d instanceof IntData i ? i.value() : null;
  }

  private static String hex(PlutusData d) {
    return d instanceof BytesData b ? b.hex() : null;
  }

  private static Credential credential(PlutusData d) {
    Constr c = constr(d);
    if (c == null || c.fields().size() != 1 || c.index().compareTo(BigInteger.ONE) > 0 || c.index().signum() < 0) {
      return null;
    }
    String hash = hex(c.fields().get(0));
    if (hash == null || hash.length() != CREDENTIAL_HASH_HEX_LENGTH) {
      return null;
    }
    return new Credential(c.index().equals(BigInteger.ONE), hash);
  }

  private static AddressCredentials address(PlutusData d) {
    Constr c = constr(d);
    if (c == null || c.index().signum() != 0 || c.fields().size() != 2) {
      return null;
    }
    Credential payment = credential(c.fields().get(0));
    Constr option = constr(c.fields().get(1));
    if (payment == null || option == null) {
      return null;
    }
    if (option.index().equals(BigInteger.ONE)) {
      return option.fields().isEmpty() ? new AddressCredentials(payment, null, null) : null;
    }
    if (option.index().signum() != 0 || option.fields().size() != 1) {
      return null;
    }
    Constr ref = constr(option.fields().get(0));
    if (ref == null) {
      return null;
    }
    if (ref.index().signum() == 0 && ref.fields().size() == 1) {
      Credential stake = credential(ref.fields().get(0));
      return stake == null ? null : new AddressCredentials(payment, stake, null);
    }
    if (ref.index().equals(BigInteger.ONE) && ref.fields().size() == 3) {
      BigInteger slot = integer(ref.fields().get(0));
      BigInteger txIndex = integer(ref.fields().get(1));
      BigInteger certIndex = integer(ref.fields().get(2));
      if (slot == null
          || txIndex == null
          || certIndex == null
          || slot.signum() < 0
          || txIndex.signum() < 0
          || certIndex.signum() < 0) {
        return null;
      }
      return new AddressCredentials(payment, null, new Pointer(slot, txIndex, certIndex));
    }
    return null;
  }

  /** {@code Some(addr)} → the address; {@code None} → {@code NONE}; else {@code null}. */
  private static final AddressCredentials NONE = new AddressCredentials(new Credential(false, ""), null, null);

  private static AddressCredentials optionAddress(PlutusData d) {
    Constr c = constr(d);
    if (c == null) {
      return null;
    }
    if (c.index().equals(BigInteger.ONE) && c.fields().isEmpty()) {
      return NONE;
    }
    if (c.index().signum() != 0 || c.fields().size() != 1) {
      return null;
    }
    return address(c.fields().get(0));
  }

  /**
   * Parses a lock datum. Total: {@code null} on any structural mismatch.
   *
   * @param datumCbor the datum's CBOR bytes
   * @return the view, or {@code null}
   */
  public static View parse(byte[] datumCbor) {
    PlutusData data;
    try {
      data = PlutusData.fromCbor(datumCbor);
    } catch (RuntimeException e) {
      return null;
    }
    Constr root = constr(data);
    if (root == null || root.index().signum() != 0 || root.fields().size() != 19) {
      return null;
    }
    List<PlutusData> f = root.fields();
    AddressCredentials buyer = address(f.get(0));
    AddressCredentials buyerReturn = optionAddress(f.get(1));
    AddressCredentials seller = address(f.get(2));
    AddressCredentials sellerReturn = optionAddress(f.get(3));
    Constr state = constr(f.get(18));
    if (state != null && !state.fields().isEmpty()) {
      return null;
    }
    String referenceKey = hex(f.get(4));
    String referenceSignature = hex(f.get(5));
    String sellerNonce = hex(f.get(6));
    String buyerNonce = hex(f.get(7));
    String agentIdentifier = hex(f.get(8));
    BigInteger collateral = integer(f.get(9));
    String inputHash = hex(f.get(10));
    String resultHash = hex(f.get(11));
    BigInteger payByTime = integer(f.get(12));
    BigInteger submitResultTime = integer(f.get(13));
    BigInteger unlockTime = integer(f.get(14));
    BigInteger externalDisputeUnlockTime = integer(f.get(15));
    BigInteger sellerCooldown = integer(f.get(16));
    BigInteger buyerCooldown = integer(f.get(17));
    if (buyer == null
        || buyerReturn == null
        || seller == null
        || sellerReturn == null
        || referenceKey == null
        || referenceSignature == null
        || sellerNonce == null
        || buyerNonce == null
        || agentIdentifier == null
        || collateral == null
        || inputHash == null
        || resultHash == null
        || payByTime == null
        || submitResultTime == null
        || unlockTime == null
        || externalDisputeUnlockTime == null
        || sellerCooldown == null
        || buyerCooldown == null
        || state == null) {
      return null;
    }
    return new View(
        buyer,
        buyerReturn == NONE ? null : buyerReturn,
        seller,
        sellerReturn == NONE ? null : sellerReturn,
        referenceKey,
        referenceSignature,
        sellerNonce,
        buyerNonce,
        agentIdentifier,
        collateral,
        inputHash,
        resultHash,
        payByTime,
        submitResultTime,
        unlockTime,
        externalDisputeUnlockTime,
        sellerCooldown,
        buyerCooldown,
        state.index());
  }
}
