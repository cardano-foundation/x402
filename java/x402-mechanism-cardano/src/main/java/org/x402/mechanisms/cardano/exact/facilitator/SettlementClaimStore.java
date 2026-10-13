package org.x402.mechanisms.cardano.exact.facilitator;

import java.util.Optional;

/**
 * Duplicate-settlement guard shared by every facilitator worker (TS {@code
 * CardanoSettlementStore}). Keyed by the canonical transaction id, it makes sure one transaction
 * is broadcast at most once and lets a retry resume observing it.
 *
 * <p>Contract for implementations (JDBC, Redis, ...): every operation is atomic across all
 * instances sharing the store; a claim taken before broadcast (in flight) is never dropped; a
 * shared store should also keep submitted claims until they are confirmed or rejected, which is
 * stronger than the in-memory default (decision 006).
 *
 * <p>Decision 013 (security divergence from TS): a transaction this facilitator reported as
 * settled is terminal ({@link SettlementClaimResult#SETTLED}), and public verify refuses any
 * transaction the store knows ({@link #claimState}). Both methods are abstract on purpose: a store
 * that cannot answer them would silently re-open the replay.
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
   * The state of the stored record for a transaction, read by public verify (decisions 013,
   * 125). Must reflect every write already acknowledged to any instance sharing the store.
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
}
