package org.x402.mechanisms.cardano;

import com.bloxbean.cardano.client.crypto.Blake2bUtil;
import com.bloxbean.cardano.client.crypto.api.impl.EdDSASigningProvider;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Decodes a base64 signed Cardano transaction (TS {@code decodeCardanoTransaction}). Everything
 * is read from the wire bytes: the transaction id hashes the body's exact bytes, output sizes and
 * inline datums are the bytes the ledger sees. Nothing is re-encoded.
 */
public final class CardanoTransactionDecoder {

  private static final EdDSASigningProvider ED25519 = new EdDSASigningProvider();
  private static final HexFormat HEX = HexFormat.of();

  private CardanoTransactionDecoder() {}

  /**
   * Strictly decodes canonical padded base64 within the 64 KiB budget.
   *
   * @param transactionBase64 the transaction
   * @return the bytes
   * @throws IllegalArgumentException when oversized or not canonical base64
   */
  public static byte[] transactionBytes(String transactionBase64) {
    if (transactionBase64 == null
        || transactionBase64.isEmpty()
        || transactionBase64.length() > maxBase64Length()) {
      throw new IllegalArgumentException("Cardano transaction exceeds the decode limit");
    }
    byte[] decoded;
    try {
      decoded = Base64.getDecoder().decode(transactionBase64);
    } catch (IllegalArgumentException e) {
      throw new IllegalArgumentException("Cardano transaction must use canonical padded base64", e);
    }
    if (decoded.length == 0
        || decoded.length > CardanoConstants.MAX_TRANSACTION_BYTES
        || !Base64.getEncoder().encodeToString(decoded).equals(transactionBase64)) {
      throw new IllegalArgumentException("Cardano transaction must use canonical padded base64");
    }
    return decoded;
  }

  /**
   * The longest base64 text a 64 KiB transaction can have.
   *
   * @return {@code ceil(65536 / 3) * 4}
   */
  public static int maxBase64Length() {
    return (CardanoConstants.MAX_TRANSACTION_BYTES + 2) / 3 * 4;
  }

  /**
   * Decodes a base64 transaction.
   *
   * @param transactionBase64 the transaction
   * @return the decoded view
   * @throws IllegalArgumentException when it is not a well-formed transaction
   */
  public static DecodedCardanoTransaction decode(String transactionBase64) {
    byte[] raw = transactionBytes(transactionBase64);
    Cbor.Item tx = Cbor.decode(raw);
    if (tx.major() != Cbor.Major.ARRAY || tx.items().size() != 4) {
      // Evolution (TS) decodes only the 4-element [body, witnessSet, isValid, auxiliaryData].
      throw new IllegalArgumentException("transaction must be a 4-element array");
    }
    Cbor.Item body = tx.items().get(0);
    Cbor.Item witnessSet = tx.items().get(1);
    if (body.major() != Cbor.Major.MAP || witnessSet.major() != Cbor.Major.MAP) {
      throw new IllegalArgumentException("transaction body and witness set must be maps");
    }
    // Decision 120: Evolution keeps the last duplicate entry; refuse rather than guess.
    body.requireUniqueKeys("transaction body");
    witnessSet.requireUniqueKeys("witness set");
    Cbor.Item flag = tx.items().get(2);
    if (!flag.isSimple(20) && !flag.isSimple(21)) {
      throw new IllegalArgumentException("is_valid must be a boolean");
    }
    boolean isValid = flag.isSimple(21);

    byte[] bodyHash = Blake2bUtil.blake2bHash256(body.raw());
    List<String> inputs = inputs(body.get(0));
    List<DecodedCardanoTransaction.Output> outputs = outputs(body.get(1));
    BigInteger fee = unsigned(body.get(2), "fee");

    List<String> balanceChanging = new ArrayList<>();
    if (body.get(9) != null) {
      balanceChanging.add("mint");
    }
    if (body.get(5) != null) {
      balanceChanging.add("withdrawals");
    }
    if (body.get(4) != null) {
      balanceChanging.add("certificates");
    }
    if (body.get(20) != null) {
      balanceChanging.add("proposalProcedures");
    }
    if (body.get(22) != null) {
      balanceChanging.add("donation");
    }

    Integer networkId = null;
    if (body.get(15) != null) {
      networkId = unsigned(body.get(15), "network id").intValueExact();
    }

    Witnesses w = witnesses(witnessSet, bodyHash);
    return new DecodedCardanoTransaction(
        HEX.formatHex(bodyHash),
        networkId,
        optionalUnsigned(body.get(3), "ttl"),
        optionalUnsigned(body.get(8), "validity start"),
        inputs,
        fee,
        raw.length,
        balanceChanging,
        outputs,
        w.vkeyCount,
        w.vkeyHashes,
        w.scriptCount,
        w.redeemerCount,
        w.signaturesValid,
        isValid);
  }

  private static BigInteger unsigned(Cbor.Item item, String what) {
    if (item == null || item.major() != Cbor.Major.UNSIGNED) {
      throw new IllegalArgumentException(what + " must be an unsigned integer");
    }
    return item.integer();
  }

  private static BigInteger optionalUnsigned(Cbor.Item item, String what) {
    return item == null ? null : unsigned(item, what);
  }

  private static List<String> inputs(Cbor.Item item) {
    if (item == null) {
      throw new IllegalArgumentException("transaction has no inputs field");
    }
    Cbor.Item set = item.untagSet();
    if (set.major() != Cbor.Major.ARRAY) {
      throw new IllegalArgumentException("inputs must be an array");
    }
    List<String> result = new ArrayList<>();
    for (Cbor.Item input : set.items()) {
      if (input.major() != Cbor.Major.ARRAY
          || input.items().size() != 2
          || input.items().get(0).major() != Cbor.Major.BYTES
          || input.items().get(0).bytes().length != 32) {
        throw new IllegalArgumentException("invalid transaction input");
      }
      result.add(
          HEX.formatHex(input.items().get(0).bytes())
              + "#"
              + unsigned(input.items().get(1), "input index"));
    }
    return result;
  }

  private static List<DecodedCardanoTransaction.Output> outputs(Cbor.Item item) {
    if (item == null || item.major() != Cbor.Major.ARRAY) {
      throw new IllegalArgumentException("outputs must be an array");
    }
    List<DecodedCardanoTransaction.Output> result = new ArrayList<>();
    for (Cbor.Item output : item.items()) {
      result.add(output(output));
    }
    return result;
  }

  private static DecodedCardanoTransaction.Output output(Cbor.Item output) {
    Cbor.Item address;
    Cbor.Item value;
    Cbor.Item datumOption = null;
    boolean referenceScript = false;
    if (output.major() == Cbor.Major.ARRAY) {
      if (output.items().size() < 2 || output.items().size() > 3) {
        throw new IllegalArgumentException("invalid legacy output");
      }
      address = output.items().get(0);
      value = output.items().get(1);
    } else if (output.major() == Cbor.Major.MAP) {
      output.requireUniqueKeys("transaction output");
      address = output.get(0);
      value = output.get(1);
      datumOption = output.get(2);
      referenceScript = output.get(3) != null;
    } else {
      throw new IllegalArgumentException("invalid transaction output");
    }
    if (address == null || address.major() != Cbor.Major.BYTES || value == null) {
      throw new IllegalArgumentException("output needs an address and a value");
    }
    String bech32 = CardanoAddresses.toBech32(address.bytes());

    BigInteger coin;
    Map<String, BigInteger> assets = new LinkedHashMap<>();
    if (value.major() == Cbor.Major.UNSIGNED) {
      coin = value.integer();
    } else if (value.major() == Cbor.Major.ARRAY && value.items().size() == 2) {
      coin = unsigned(value.items().get(0), "output coin");
      Cbor.Item multiAsset = value.items().get(1);
      if (multiAsset.major() != Cbor.Major.MAP) {
        throw new IllegalArgumentException("multi-asset must be a map");
      }
      for (Map.Entry<Cbor.Item, Cbor.Item> policy : multiAsset.entries()) {
        if (policy.getKey().major() != Cbor.Major.BYTES
            || policy.getKey().bytes().length != 28
            || policy.getValue().major() != Cbor.Major.MAP) {
          throw new IllegalArgumentException("invalid policy entry");
        }
        String policyHex = HEX.formatHex(policy.getKey().bytes());
        for (Map.Entry<Cbor.Item, Cbor.Item> asset : policy.getValue().entries()) {
          if (asset.getKey().major() != Cbor.Major.BYTES || asset.getKey().bytes().length > 32) {
            throw new IllegalArgumentException("invalid asset name");
          }
          assets.put(
              policyHex + "." + HEX.formatHex(asset.getKey().bytes()),
              unsigned(asset.getValue(), "asset quantity"));
        }
      }
    } else {
      throw new IllegalArgumentException("invalid output value");
    }

    String datum = null;
    if (datumOption != null) {
      if (datumOption.major() != Cbor.Major.ARRAY
          || datumOption.items().size() != 2
          || datumOption.items().get(0).major() != Cbor.Major.UNSIGNED) {
        throw new IllegalArgumentException("invalid datum option");
      }
      BigInteger kind = datumOption.items().get(0).integer();
      if (!kind.equals(BigInteger.ZERO) && !kind.equals(BigInteger.ONE)) {
        throw new IllegalArgumentException("invalid datum option kind");
      }
      if (kind.equals(BigInteger.ONE)) {
        Cbor.Item wrapped = datumOption.items().get(1);
        if (wrapped.major() != Cbor.Major.TAG
            || wrapped.integer().intValue() != 24
            || wrapped.tagged().major() != Cbor.Major.BYTES) {
          throw new IllegalArgumentException("inline datum must be #6.24(bytes)");
        }
        byte[] datumBytes = wrapped.tagged().bytes();
        PlutusData.fromCbor(datumBytes);
        datum = HEX.formatHex(datumBytes);
      }
    }
    return new DecodedCardanoTransaction.Output(
        bech32, coin, assets, datum, output.size(), referenceScript);
  }

  private static final class Witnesses {
    int vkeyCount;
    List<String> vkeyHashes = new ArrayList<>();
    int scriptCount;
    int redeemerCount;
    boolean signaturesValid = true;
  }

  private static Witnesses witnesses(Cbor.Item set, byte[] bodyHash) {
    Witnesses w = new Witnesses();
    Cbor.Item vkeys = set.get(0);
    if (vkeys != null) {
      for (Cbor.Item witness : array(vkeys, "vkey witnesses")) {
        if (witness.major() != Cbor.Major.ARRAY
            || witness.items().size() != 2
            || witness.items().get(0).major() != Cbor.Major.BYTES
            || witness.items().get(0).bytes().length != 32
            || witness.items().get(1).major() != Cbor.Major.BYTES
            || witness.items().get(1).bytes().length != 64) {
          throw new IllegalArgumentException("invalid vkey witness");
        }
        byte[] vkey = witness.items().get(0).bytes();
        byte[] signature = witness.items().get(1).bytes();
        w.vkeyCount++;
        w.vkeyHashes.add(HEX.formatHex(Blake2bUtil.blake2bHash224(vkey)).toLowerCase(Locale.ROOT));
        if (w.signaturesValid && !verify(signature, bodyHash, vkey)) {
          w.signaturesValid = false;
        }
      }
    }
    w.vkeyCount += count(set.get(2), "bootstrap witnesses");
    w.scriptCount += count(set.get(1), "native scripts");
    w.scriptCount += count(set.get(3), "plutus v1 scripts");
    w.scriptCount += count(set.get(6), "plutus v2 scripts");
    w.scriptCount += count(set.get(7), "plutus v3 scripts");
    Cbor.Item redeemers = set.get(5);
    if (redeemers != null) {
      if (redeemers.major() == Cbor.Major.MAP) {
        w.redeemerCount = redeemers.entries().size();
      } else {
        w.redeemerCount = array(redeemers, "redeemers").size();
      }
    }
    w.scriptCount += w.redeemerCount;
    return w;
  }

  private static boolean verify(byte[] signature, byte[] message, byte[] vkey) {
    try {
      return ED25519.verify(signature, message, vkey);
    } catch (RuntimeException e) {
      return false;
    }
  }

  private static List<Cbor.Item> array(Cbor.Item item, String what) {
    Cbor.Item set = item.untagSet();
    if (set.major() != Cbor.Major.ARRAY) {
      throw new IllegalArgumentException(what + " must be an array");
    }
    return set.items();
  }

  private static int count(Cbor.Item item, String what) {
    return item == null ? 0 : array(item, what).size();
  }
}
