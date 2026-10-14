package org.x402.mechanisms.cardano;

import com.bloxbean.cardano.client.common.model.SlotConfig;
import com.bloxbean.cardano.client.common.model.SlotConfigs;
import java.math.BigInteger;
import java.time.Clock;
import java.util.List;
import java.util.Map;

/**
 * Cardano network identifiers, CIP-34 aliases and slot↔time conversion.
 */
public final class CardanoNetworks {

  /** Cardano mainnet. */
  public static final String MAINNET = "cardano:mainnet";
  /** Cardano preprod testnet. */
  public static final String PREPROD = "cardano:preprod";
  /** Cardano preview testnet. */
  public static final String PREVIEW = "cardano:preview";
  /** Every supported network, canonical form. */
  public static final List<String> ALL = List.of(MAINNET, PREPROD, PREVIEW);

  /** CIP-34 alias of mainnet. */
  public static final String MAINNET_CIP34 = "cip34:1-764824073";
  /** CIP-34 alias of preprod. */
  public static final String PREPROD_CIP34 = "cip34:0-1";
  /** CIP-34 alias of preview. */
  public static final String PREVIEW_CIP34 = "cip34:0-2";

  private static final Map<String, String> ALIASES =
      Map.of(MAINNET_CIP34, MAINNET, PREPROD_CIP34, PREPROD, PREVIEW_CIP34, PREVIEW);

  private static final Map<String, SlotConfig> SLOT_CONFIGS =
      Map.of(
          MAINNET, SlotConfigs.mainnet(),
          PREPROD, SlotConfigs.preprod(),
          PREVIEW, SlotConfigs.preview());

  private CardanoNetworks() {}

  /**
   * Folds a CIP-34 alias to its canonical id; any other value is returned unchanged.
   *
   * @param network the network identifier
   * @return the canonical id, or the input
   */
  public static String normalize(String network) {
    return network == null ? null : ALIASES.getOrDefault(network, network);
  }

  /**
   * Whether the identifier names a supported Cardano network (aliases included).
   *
   * @param network the network identifier
   * @return true for mainnet, preprod and preview
   */
  public static boolean isCardanoNetwork(String network) {
    return network != null && ALL.contains(normalize(network));
  }

  /**
   * The network id encoded in transaction bodies and addresses: 1 for mainnet, 0 for testnets.
   *
   * @param network the network identifier
   * @return the network id
   * @throws IllegalArgumentException for an unsupported network
   */
  public static int networkId(String network) {
    String n = normalize(network);
    if (MAINNET.equals(n)) {
      return 1;
    }
    if (PREPROD.equals(n) || PREVIEW.equals(n)) {
      return 0;
    }
    throw new IllegalArgumentException("Unsupported Cardano network: " + network);
  }

  /**
   * The slot configuration of a network.
   *
   * @param network the network identifier
   * @return the configuration
   * @throws IllegalArgumentException when the network has none
   */
  public static SlotConfig slotConfig(String network) {
    SlotConfig config = network == null ? null : SLOT_CONFIGS.get(normalize(network));
    if (config == null) {
      throw new IllegalArgumentException("No slot config for network: " + network);
    }
    return config;
  }

  /**
   * POSIX milliseconds of an absolute slot, in exact integer arithmetic (no overflow).
   *
   * @param network the network identifier
   * @param slot the absolute slot
   * @return the wall-clock time of the slot
   */
  public static BigInteger slotToPosixMs(String network, BigInteger slot) {
    SlotConfig c = slotConfig(network);
    return BigInteger.valueOf(c.getZeroTime())
        .add(slot.subtract(BigInteger.valueOf(c.getZeroSlot())).multiply(BigInteger.valueOf(c.getSlotLength())));
  }

  /**
   * The current slot derived from a clock.
   *
   * @param network the network identifier
   * @param clock the clock
   * @return the current absolute slot
   */
  public static long currentSlot(String network, Clock clock) {
    return posixMsToSlot(network, clock.millis());
  }

  /**
   * The absolute slot containing a POSIX time.
   *
   * @param network the network identifier
   * @param posixMs the wall-clock time in milliseconds
   * @return the slot
   */
  public static long posixMsToSlot(String network, long posixMs) {
    SlotConfig c = slotConfig(network);
    return c.getZeroSlot() + Math.floorDiv(posixMs - c.getZeroTime(), c.getSlotLength());
  }
}
