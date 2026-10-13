package org.x402.mechanisms.cardano.exact.facilitator;

import java.time.Clock;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

/**
 * Bounded process-local {@link SettlementClaimStore}, the facilitator default, mirroring TS
 * {@code InMemoryCardanoSettlementStore} exactly (decision 006): {@code markSubmitted} clears the
 * in-flight flag, and once full the oldest record that is no longer in flight is evicted with its
 * terms binding. A claim before broadcast is never evicted; when every record is in flight a
 * claim reports {@link SettlementClaimResult#CAPACITY_EXCEEDED}. Settled records (decision 013)
 * are evictable like any other record no longer in flight; after eviction the spent nonce (rule
 * 5) refuses a replay. Single instance only.
 */
public final class InMemorySettlementClaimStore implements SettlementClaimStore {

  /** Default combined capacity of transaction and terms entries. */
  public static final int DEFAULT_MAX_ENTRIES = 4096;

  private static final class Record {
    final String txHash;
    final String ownerToken;
    final String termsDigest;
    final Long retainUntilMs;
    boolean inFlight = true;
    boolean rejected;
    boolean settled;

    Record(SettlementClaim claim) {
      this.txHash = claim.txHash();
      this.ownerToken = claim.ownerToken();
      this.termsDigest = claim.termsDigest();
      this.retainUntilMs = claim.retainUntilMs();
    }

    /**
     * Decision 126 (divergence from TS): a broadcast record is kept until its transaction can no
     * longer land (TTL plus grace); without a known TTL, forever. Rejected records may go.
     */
    boolean evictable(long now) {
      if (inFlight) {
        return false;
      }
      return rejected || (retainUntilMs != null && now >= retainUntilMs);
    }
  }

  private final Map<String, Record> submissions = new LinkedHashMap<>();
  private final Map<String, String> terms = new HashMap<>();
  private final int maxEntries;
  private final Clock clock;

  /** Creates a store with {@link #DEFAULT_MAX_ENTRIES}. */
  public InMemorySettlementClaimStore() {
    this(DEFAULT_MAX_ENTRIES);
  }

  /**
   * Creates a bounded store.
   *
   * @param maxEntries combined transaction and terms entry limit
   */
  public InMemorySettlementClaimStore(int maxEntries) {
    this(maxEntries, Clock.systemUTC());
  }

  /**
   * A store with a capacity and the clock its retention rule reads (decision 126).
   *
   * @param maxEntries the capacity
   * @param clock the clock
   */
  public InMemorySettlementClaimStore(int maxEntries, Clock clock) {
    if (maxEntries <= 0) {
      throw new IllegalArgumentException("maxEntries must be a positive integer");
    }
    this.maxEntries = maxEntries;
    this.clock = Objects.requireNonNull(clock, "clock");
  }

  @Override
  public synchronized SettlementClaimResult claimSettlement(SettlementClaim claim) {
    String existingTerms = claim.termsDigest() == null ? null : terms.get(claim.termsDigest());
    if (existingTerms != null && !existingTerms.equals(claim.txHash())) {
      return SettlementClaimResult.TERMS_CONFLICT;
    }
    Record existing = submissions.get(claim.txHash());
    if (existing != null) {
      if (!Objects.equals(existing.termsDigest, claim.termsDigest())) {
        return SettlementClaimResult.TERMS_CONFLICT;
      }
      if (existing.rejected) {
        return SettlementClaimResult.REJECTED;
      }
      if (existing.settled) {
        return SettlementClaimResult.SETTLED;
      }
      return existing.inFlight ? SettlementClaimResult.IN_FLIGHT : SettlementClaimResult.SUBMITTED;
    }
    int required = 1 + (claim.termsDigest() != null && existingTerms == null ? 1 : 0);
    while (submissions.size() + terms.size() + required > maxEntries) {
      if (!evictOldestSettled()) {
        return SettlementClaimResult.CAPACITY_EXCEEDED;
      }
    }
    if (claim.termsDigest() != null && existingTerms == null) {
      terms.put(claim.termsDigest(), claim.txHash());
    }
    submissions.put(claim.txHash(), new Record(claim));
    return SettlementClaimResult.FRESH;
  }

  @Override
  public synchronized void markSubmitted(String txHash, String ownerToken) {
    Record record = submissions.get(txHash);
    if (record != null && record.ownerToken.equals(ownerToken) && !record.settled) {
      record.inFlight = false;
      record.rejected = false;
    }
  }

  @Override
  public synchronized void markRejected(String txHash, String ownerToken) {
    Record record = submissions.get(txHash);
    if (record != null && record.ownerToken.equals(ownerToken) && !record.settled) {
      record.inFlight = false;
      record.rejected = true;
    }
  }

  @Override
  public synchronized boolean markSettled(String txHash, String ownerToken) {
    Record record = submissions.get(txHash);
    if (record == null || record.rejected || record.settled) {
      return false;
    }
    if (record.inFlight && !record.ownerToken.equals(ownerToken)) {
      return false;
    }
    record.inFlight = false;
    record.settled = true;
    return true;
  }

  @Override
  public synchronized Optional<SettlementClaimState> claimState(String txHash) {
    Record record = submissions.get(txHash);
    if (record == null) {
      return Optional.empty();
    }
    if (record.rejected) {
      return Optional.of(SettlementClaimState.REJECTED);
    }
    if (record.settled) {
      return Optional.of(SettlementClaimState.SETTLED);
    }
    return Optional.of(record.inFlight ? SettlementClaimState.IN_FLIGHT : SettlementClaimState.SUBMITTED);
  }

  @Override
  public synchronized void releaseClaim(String txHash, String ownerToken) {
    Record record = submissions.get(txHash);
    if (record == null || !record.ownerToken.equals(ownerToken) || !record.inFlight) {
      return;
    }
    submissions.remove(txHash);
    dropTerms(record);
  }

  private void dropTerms(Record record) {
    if (record.termsDigest != null && record.txHash.equals(terms.get(record.termsDigest))) {
      terms.remove(record.termsDigest);
    }
  }

  private boolean evictOldestSettled() {
    long now = clock.millis();
    Iterator<Record> it = submissions.values().iterator();
    while (it.hasNext()) {
      Record record = it.next();
      if (!record.evictable(now)) {
        continue;
      }
      it.remove();
      dropTerms(record);
      return true;
    }
    return false;
  }
}
