package org.x402.mechanisms.cardano;

import java.math.BigInteger;
import java.time.Clock;
import java.util.List;
import java.util.Map;

/**
 * Cardano network identifiers, CIP-34 aliases and slot↔time conversion (TS {@code constants.ts},
 * {@code utils.ts:slotToPosixMs}).
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

  /**
   * Shelley-era slot configuration (Evolution {@code SLOT_CONFIG_NETWORK}).
   *
   * @param zeroTimeMs POSIX milliseconds of {@code zeroSlot}
   * @param zeroSlot the first slot of the configuration
   * @param slotLengthMs milliseconds per slot
   */
  public record SlotConfig(long zeroTimeMs, long zeroSlot, long slotLengthMs) {}

  private static final Map<String, SlotConfig> SLOT_CONFIGS =
      Map.of(
          MAINNET, new SlotConfig(1_596_059_091_000L, 4_492_800L, 1000L),
          PREPROD, new SlotConfig(1_655_769_600_000L, 86_400L, 1000L),
          PREVIEW, new SlotConfig(1_666_656_000_000L, 0L, 1000L));

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
    return BigInteger.valueOf(c.zeroTimeMs())
        .add(slot.subtract(BigInteger.valueOf(c.zeroSlot())).multiply(BigInteger.valueOf(c.slotLengthMs())));
  }

  /**
   * The current slot derived from a clock (TS reference signer {@code getCurrentSlot}).
   *
   * @param network the network identifier
   * @param clock the clock
   * @return the current absolute slot
   */
  public static long currentSlot(String network, Clock clock) {
    SlotConfig c = slotConfig(network);
    return c.zeroSlot() + Math.floorDiv(clock.millis() - c.zeroTimeMs(), c.slotLengthMs());
  }
}
