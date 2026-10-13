package org.x402.core.client;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * Client spend controls (TS {@code SpendControls}, {@code x402Client.ts:156}, :170-192), on by
 * default: only assets the scheme recognizes as the network's default asset ({@code
 * findDefaultAsset}; USDM on Cardano) are paid, capped at {@code $1} per payment. Other assets need
 * an {@link AllowedAsset} entry, {@link Builder#allowAnyAsset()}, or {@link #disabled()}.
 *
 * @param enabled {@code false} = TS {@code spendControls: false}
 * @param maxAmountPerPayment the USD cap for default assets as a money string, or {@code null} for
 *     no USD cap (TS {@code maxAmountPerPayment: false})
 * @param allowAnyAsset TS {@code allowedAssets: true}
 * @param allowedAssets extra allowed assets with optional atomic caps
 */
public record SpendControls(
    boolean enabled, String maxAmountPerPayment, boolean allowAnyAsset,
    List<AllowedAsset> allowedAssets) {

  /** TS {@code DEFAULT_MAX_AMOUNT_PER_PAYMENT}. */
  public static final String DEFAULT_MAX_AMOUNT_PER_PAYMENT = "$1";

  /** Copies the list. */
  public SpendControls {
    allowedAssets = allowedAssets == null ? List.of() : List.copyOf(allowedAssets);
  }

  /**
   * An allowed asset (TS {@code SpendControlAsset}).
   *
   * @param network a network or pattern such as {@code cardano:*}
   * @param asset the asset identifier, or the default asset's symbol (case-insensitive)
   * @param maxAmountPerPayment the cap in atomic units, or {@code null} for none
   */
  public record AllowedAsset(String network, String asset, String maxAmountPerPayment) {

    /** Validates. */
    public AllowedAsset {
      Objects.requireNonNull(network, "network");
      Objects.requireNonNull(asset, "asset");
    }
  }

  /**
   * TS defaults: default assets only, {@code $1} cap.
   *
   * @return the controls
   */
  public static SpendControls defaults() {
    return new SpendControls(true, DEFAULT_MAX_AMOUNT_PER_PAYMENT, false, List.of());
  }

  /**
   * No spend controls at all.
   *
   * @return the controls
   */
  public static SpendControls disabled() {
    return new SpendControls(false, null, false, List.of());
  }

  /**
   * Starts from the defaults.
   *
   * @return a builder
   */
  public static Builder builder() {
    return new Builder();
  }

  /** Builds {@link SpendControls}. */
  public static final class Builder {
    private String maxAmountPerPayment = DEFAULT_MAX_AMOUNT_PER_PAYMENT;
    private boolean allowAnyAsset;
    private final List<AllowedAsset> allowed = new ArrayList<>();

    private Builder() {}

    /**
     * Sets the USD cap for default assets.
     *
     * @param money a money string such as {@code "$2"}
     * @return this builder
     */
    public Builder maxAmountPerPayment(String money) {
      this.maxAmountPerPayment = Objects.requireNonNull(money, "money");
      return this;
    }

    /**
     * Removes the USD cap (TS {@code maxAmountPerPayment: false}).
     *
     * @return this builder
     */
    public Builder noUsdCap() {
      this.maxAmountPerPayment = null;
      return this;
    }

    /**
     * Allows any asset (TS {@code allowedAssets: true}).
     *
     * @return this builder
     */
    public Builder allowAnyAsset() {
      this.allowAnyAsset = true;
      return this;
    }

    /**
     * Adds allowed assets.
     *
     * @param assets the entries
     * @return this builder
     */
    public Builder allowedAssets(List<AllowedAsset> assets) {
      allowed.addAll(assets);
      return this;
    }

    /**
     * Builds the controls.
     *
     * @return the controls
     */
    public SpendControls build() {
      return new SpendControls(true, maxAmountPerPayment, allowAnyAsset, allowed);
    }
  }
}
