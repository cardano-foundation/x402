package org.x402.mechanisms.cardano.exact.facilitator;

/** Outcome of {@link SettlementClaimStore#claimSettlement}. */
public enum SettlementClaimResult {
  /** Nothing claimed this transaction; the caller submits it. */
  FRESH,
  /** Another call is mid-submission; refused as a duplicate. */
  IN_FLIGHT,
  /** Already broadcast: resume observing, never submit again. */
  SUBMITTED,
  /** This facilitator already reported success for the transaction; it is terminal. */
  SETTLED,
  /** The node definitively rejected these bytes; never resubmit. */
  REJECTED,
  /** The Masumi terms are bound to another transaction. */
  TERMS_CONFLICT,
  /** The store is full and nothing in it can be evicted (see {@link InMemorySettlementClaimStore}). */
  CAPACITY_EXCEEDED;
}
