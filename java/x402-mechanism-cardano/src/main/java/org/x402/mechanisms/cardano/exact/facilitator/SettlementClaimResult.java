package org.x402.mechanisms.cardano.exact.facilitator;

/** Outcome of {@link SettlementClaimStore#claimSettlement} (TS {@code CardanoSettlementClaimResult}). */
public enum SettlementClaimResult {
  /** Nothing claimed this transaction; the caller submits it. */
  FRESH("fresh"),
  /** Another call is mid-submission; refused as a duplicate. */
  IN_FLIGHT("in-flight"),
  /** Already broadcast: resume observing, never submit again. */
  SUBMITTED("submitted"),
  /** This facilitator already reported success for the transaction; it is terminal (decision 013). */
  SETTLED("settled"),
  /** The node definitively rejected these bytes; never resubmit. */
  REJECTED("rejected"),
  /** The Masumi terms are bound to another transaction. */
  TERMS_CONFLICT("terms-conflict"),
  /** Every retained record is mid-submission and the store is full. */
  CAPACITY_EXCEEDED("capacity-exceeded");

  private final String wire;

  SettlementClaimResult(String wire) {
    this.wire = wire;
  }

  /**
   * The TS string.
   *
   * @return the wire name
   */
  public String wire() {
    return wire;
  }
}
