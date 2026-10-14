package org.x402.mechanisms.cardano.exact.facilitator;

/**
 * The state of a stored settlement claim, as public verify needs it.
 */
public enum SettlementClaimState {
  /** Claimed, not yet broadcast (or the broadcast outcome is not recorded yet). */
  IN_FLIGHT,
  /** Broadcast; settlement may still be pending. Public verify resumes verification of it. */
  SUBMITTED,
  /** This facilitator reported success; terminal. */
  SETTLED,
  /** The node definitively rejected it; terminal. */
  REJECTED
}
