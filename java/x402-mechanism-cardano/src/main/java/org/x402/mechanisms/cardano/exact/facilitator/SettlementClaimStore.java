package org.x402.mechanisms.cardano.exact.facilitator;

import java.util.Optional;

/**
 * Duplicate-settlement guard shared by every facilitator worker. Keyed by the canonical
 * transaction id, it makes sure one transaction is broadcast at most once while its claim is
 * retained, lets a retry resume observing it, and lets success be reported at most once. (An unconfirmed record dropped for room may be
 * broadcast again; the ledger accepts it at most once and no second success is reported.)
 *
 * <p>Contract for implementations (JDBC, Redis, ...), every operation atomic across all instances
 * sharing the store:
 *
 * <ul>
 *   <li>a claim taken before broadcast (in flight) is never dropped;
 *   <li>a submitted or settled record is kept at least until its {@link
 *       SettlementClaim#retainUntilMs()} (the transaction's TTL plus a grace), and forever when
 *       that is {@code null}. Dropping it earlier would let a transaction still in a mempool be
 *       settled, and paid for, a second time;
 *   <li>a record marked by {@link #markSubmissionUnconfirmed} that never settled may be dropped
 *       when the store needs room: its broadcast outcome is unknown and no success was reported
 *       for it, so dropping it can never produce a second success;
 *   <li>a rejected record may be dropped at any time.
 * </ul>
 *
 * <p>Known limit: when the store is unreachable for a whole settle after the broadcast (or the
 * process dies there), the claim stays in flight, and retries answer {@code
 * duplicate_settlement} even once the payment lands. Nothing is paid twice; the payer just never
 * sees a success for it.
 *
 * <p>A transaction this facilitator reported as settled is terminal ({@link
 * SettlementClaimResult#SETTLED}), and public verify refuses any transaction the store knows
 * ({@link #claimState}), except a submitted one, which a pending retry may resume. Both methods
 * are abstract on purpose: a store that cannot answer them would let a settled payment be
 * replayed.
 */
public interface SettlementClaimStore {

  /**
   * Atomically claims a transaction and its optional Masumi terms digest. Leaves no partial
   * terms binding when the claim fails.
   *
   * @param claim the claim
   * @return the outcome
   */
  SettlementClaimResult claimSettlement(SettlementClaim claim);

  /**
   * Marks an owned claim as broadcast (owner only).
   *
   * @param txHash the transaction id
   * @param ownerToken the owner token
   */
  void markSubmitted(String txHash, String ownerToken);

  /**
   * Records a definitive pre-ledger rejection as a permanent tombstone (owner only).
   *
   * @param txHash the transaction id
   * @param ownerToken the owner token
   */
  void markRejected(String txHash, String ownerToken);

  /**
   * Atomically records that this facilitator reported success for a broadcast transaction. Only
   * one caller wins: the owner of an in-flight claim, or any caller once the claim is submitted
   * (the pending retry resumes under a new owner token). Rejected or already settled records do
   * not change.
   *
   * @param txHash the transaction id
   * @param ownerToken the caller's owner token
   * @return {@code true} when this call moved the record to settled
   */
  boolean markSettled(String txHash, String ownerToken);

  /**
   * The state of the stored record for a transaction, read by public verify. Must reflect
   * every write already acknowledged to any instance sharing the store.
   *
   * @param txHash the transaction id
   * @return the state, or empty when the store holds no record
   */
  Optional<SettlementClaimState> claimState(String txHash);

  /**
   * Gives up an owned claim that is still in flight (verification failed before broadcast),
   * together with its terms binding. A no-op for another owner or a broadcast claim.
   *
   * @param txHash the transaction id
   * @param ownerToken the owner token
   */
  void releaseClaim(String txHash, String ownerToken);

  /**
   * Marks an owned claim as broadcast with an unknown outcome: the submission failed and the
   * ledger does not show the transaction. Readers see it as submitted (a retry resumes and never
   * rebroadcasts), but a store may drop it when it needs room, because no success was reported
   * for it. The default keeps it like {@link #markSubmitted}.
   *
   * @param txHash the transaction id
   * @param ownerToken the owner token
   */
  default void markSubmissionUnconfirmed(String txHash, String ownerToken) {
    markSubmitted(txHash, ownerToken);
  }

  /**
   * Records that the ledger now shows a transaction whose submission was unconfirmed, so its
   * record is kept like any other submitted one. Callable by any instance; the default does
   * nothing.
   *
   * @param txHash the transaction id
   */
  default void markSubmissionObserved(String txHash) {}
}
