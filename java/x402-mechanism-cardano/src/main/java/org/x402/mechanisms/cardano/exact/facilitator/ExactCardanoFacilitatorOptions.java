package org.x402.mechanisms.cardano.exact.facilitator;

import java.time.Clock;
import java.time.Duration;
import org.x402.mechanisms.cardano.exact.masumi.MasumiDeploymentValidator;
import org.x402.mechanisms.cardano.exact.masumi.MasumiRegistryValidator;

/**
 * Options of the Cardano facilitator scheme.
 *
 * @param settlementStore the duplicate-settlement guard (default: a bounded {@link
 *     InMemorySettlementClaimStore}, right for a single instance)
 * @param acceptMempool settle on authenticated mempool evidence when the policy allows {@code
 *     -1} (default {@code false})
 * @param confirmationTimeout how long one settle waits for the policy's evidence before
 *     answering {@code settlement_pending} (default 75 s; keep it below the resource servers'
 *     facilitator timeout of 90 s)
 * @param confirmationPoll interval between evidence polls (default 5 s)
 * @param registryValidator validates Masumi registry claims; without one a non-empty {@code
 *     agentIdentifier} is rejected
 * @param deploymentValidator approves non-canonical Masumi deployments
 * @param clock the clock of the confirmation wait (default {@code Clock.systemUTC()})
 */
public record ExactCardanoFacilitatorOptions(
    SettlementClaimStore settlementStore,
    boolean acceptMempool,
    Duration confirmationTimeout,
    Duration confirmationPoll,
    MasumiRegistryValidator registryValidator,
    MasumiDeploymentValidator deploymentValidator,
    Clock clock) {

  /** Default confirmation wait. */
  public static final Duration DEFAULT_CONFIRMATION_TIMEOUT = Duration.ofSeconds(75);
  /** Default poll interval. */
  public static final Duration DEFAULT_CONFIRMATION_POLL = Duration.ofSeconds(5);

  /** Fills defaults for {@code null} members. */
  public ExactCardanoFacilitatorOptions {
    clock = clock == null ? Clock.systemUTC() : clock;
    settlementStore =
        settlementStore == null
            ? new InMemorySettlementClaimStore(InMemorySettlementClaimStore.DEFAULT_MAX_ENTRIES, clock)
            : settlementStore;
    confirmationTimeout = confirmationTimeout == null ? DEFAULT_CONFIRMATION_TIMEOUT : confirmationTimeout;
    confirmationPoll = confirmationPoll == null ? DEFAULT_CONFIRMATION_POLL : confirmationPoll;
    if (confirmationTimeout.isNegative() || confirmationPoll.isNegative()) {
      throw new IllegalArgumentException("confirmation timeout and poll must not be negative");
    }
    try {
      // Settle converts both after broadcast, where an overflow must not surface.
      confirmationTimeout.toMillis();
      confirmationPoll.toMillis();
    } catch (ArithmeticException e) {
      throw new IllegalArgumentException("confirmation timeout and poll must fit in milliseconds", e);
    }
  }

  /**
   * The defaults, with a fresh in-memory settlement store.
   *
   * @return the options
   */
  public static ExactCardanoFacilitatorOptions defaults() {
    return builder().build();
  }

  /**
   * A builder starting from the defaults.
   *
   * @return the builder
   */
  public static Builder builder() {
    return new Builder();
  }

  /** Builder for {@link ExactCardanoFacilitatorOptions}. */
  public static final class Builder {
    private SettlementClaimStore settlementStore;
    private boolean acceptMempool;
    private Duration confirmationTimeout;
    private Duration confirmationPoll;
    private MasumiRegistryValidator registryValidator;
    private MasumiDeploymentValidator deploymentValidator;
    private Clock clock;

    private Builder() {}

    /**
     * Sets the claim store.
     *
     * @param v the store
     * @return this builder
     */
    public Builder settlementStore(SettlementClaimStore v) {
      settlementStore = v;
      return this;
    }

    /**
     * Sets mempool acceptance.
     *
     * @param v the flag
     * @return this builder
     */
    public Builder acceptMempool(boolean v) {
      acceptMempool = v;
      return this;
    }

    /**
     * Sets the confirmation wait.
     *
     * @param v the duration
     * @return this builder
     */
    public Builder confirmationTimeout(Duration v) {
      confirmationTimeout = v;
      return this;
    }

    /**
     * Sets the poll interval.
     *
     * @param v the duration
     * @return this builder
     */
    public Builder confirmationPoll(Duration v) {
      confirmationPoll = v;
      return this;
    }

    /**
     * Sets the registry validator.
     *
     * @param v the validator
     * @return this builder
     */
    public Builder registryValidator(MasumiRegistryValidator v) {
      registryValidator = v;
      return this;
    }

    /**
     * Sets the deployment validator.
     *
     * @param v the validator
     * @return this builder
     */
    public Builder deploymentValidator(MasumiDeploymentValidator v) {
      deploymentValidator = v;
      return this;
    }

    /**
     * Sets the clock.
     *
     * @param v the clock
     * @return this builder
     */
    public Builder clock(Clock v) {
      clock = v;
      return this;
    }

    /**
     * Builds the options.
     *
     * @return the options
     */
    public ExactCardanoFacilitatorOptions build() {
      return new ExactCardanoFacilitatorOptions(
          settlementStore, acceptMempool, confirmationTimeout, confirmationPoll, registryValidator,
          deploymentValidator, clock);
    }
  }
}
