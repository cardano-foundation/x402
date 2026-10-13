package org.x402.mechanisms.cardano.exact.facilitator;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;

/** Port of TS {@code test/unit/settlementStore.test.ts} plus a concurrency check (C1–C4). */
class InMemorySettlementClaimStoreTest {

  private static SettlementClaim claim(String tx, String owner) {
    return new SettlementClaim(tx, owner, null);
  }

  private static SettlementClaim claim(String tx, String owner, String terms) {
    return new SettlementClaim(tx, owner, terms);
  }

  /** Decision 126: a claim whose retention (TTL + grace) has already passed. */
  private static SettlementClaim expired(String tx, String owner, String terms) {
    return new SettlementClaim(tx, owner, terms, 0L);
  }

  @Test
  void sharesOwnerSafeClaims() {
    var store = new InMemorySettlementClaimStore(2);
    assertThat(store.claimSettlement(claim("abc", "owner-a"))).isEqualTo(SettlementClaimResult.FRESH);
    assertThat(store.claimSettlement(claim("abc", "owner-b"))).isEqualTo(SettlementClaimResult.IN_FLIGHT);
    store.markSubmitted("abc", "owner-b");
    assertThat(store.claimSettlement(claim("abc", "owner-c"))).isEqualTo(SettlementClaimResult.IN_FLIGHT);
    store.markSubmitted("abc", "owner-a");
    assertThat(store.claimSettlement(claim("abc", "owner-c"))).isEqualTo(SettlementClaimResult.SUBMITTED);
  }

  @Test
  void definitiveRejectionsAreTombstones() {
    var store = new InMemorySettlementClaimStore();
    store.claimSettlement(claim("abc", "owner-a"));
    store.markRejected("abc", "owner-b");
    assertThat(store.claimSettlement(claim("abc", "x"))).isEqualTo(SettlementClaimResult.IN_FLIGHT);
    store.markRejected("abc", "owner-a");
    assertThat(store.claimSettlement(claim("abc", "owner-b"))).isEqualTo(SettlementClaimResult.REJECTED);
  }

  @Test
  void masumiTermsStayBoundToTheirFirstTransaction() {
    var store = new InMemorySettlementClaimStore();
    assertThat(store.claimSettlement(claim("abc", "owner-a", "terms"))).isEqualTo(SettlementClaimResult.FRESH);
    assertThat(store.claimSettlement(claim("def", "owner-b", "terms")))
        .isEqualTo(SettlementClaimResult.TERMS_CONFLICT);
    assertThat(store.claimSettlement(claim("abc", "owner-c", "terms")))
        .isEqualTo(SettlementClaimResult.IN_FLIGHT);
    assertThat(store.claimSettlement(claim("abc", "owner-d")))
        .isEqualTo(SettlementClaimResult.TERMS_CONFLICT);
  }

  @Test
  void termsAndTransactionAreClaimedAtomically() {
    var store = new InMemorySettlementClaimStore(1);
    assertThat(store.claimSettlement(claim("abc", "owner-a", "terms")))
        .isEqualTo(SettlementClaimResult.CAPACITY_EXCEEDED);
    assertThat(store.claimSettlement(claim("def", "owner-b"))).isEqualTo(SettlementClaimResult.FRESH);
  }

  @Test
  void evictsTheOldestSettledClaimOnceFull() {
    var store = new InMemorySettlementClaimStore(2);
    store.claimSettlement(expired("first", "a", null));
    store.markSubmitted("first", "a");
    store.claimSettlement(expired("second", "b", null));
    store.markSubmitted("second", "b");

    assertThat(store.claimSettlement(claim("third", "c"))).isEqualTo(SettlementClaimResult.FRESH);
    assertThat(store.claimSettlement(claim("second", "e"))).isEqualTo(SettlementClaimResult.SUBMITTED);
    assertThat(store.claimSettlement(claim("first", "d"))).isEqualTo(SettlementClaimResult.FRESH);
  }

  @Test
  void dropsTheTermsBindingWithTheEvictedClaim() {
    var store = new InMemorySettlementClaimStore(2);
    store.claimSettlement(expired("lock", "a", "terms"));
    store.markSubmitted("lock", "a");
    assertThat(store.claimSettlement(expired("other", "b", null))).isEqualTo(SettlementClaimResult.FRESH);
    store.markSubmitted("other", "b");
    assertThat(store.claimSettlement(claim("replay", "c", "terms"))).isEqualTo(SettlementClaimResult.FRESH);
  }

  @Test
  void neverEvictsAClaimBeforeBroadcast() {
    var store = new InMemorySettlementClaimStore(1);
    store.claimSettlement(claim("inflight", "a"));
    assertThat(store.claimSettlement(claim("other", "b")))
        .isEqualTo(SettlementClaimResult.CAPACITY_EXCEEDED);
    assertThat(store.claimSettlement(claim("inflight", "c"))).isEqualTo(SettlementClaimResult.IN_FLIGHT);
  }

  @Test
  void releasesAnOwnedInFlightClaim() {
    var store = new InMemorySettlementClaimStore();
    store.claimSettlement(claim("abc", "owner-a", "terms"));
    store.releaseClaim("abc", "owner-b");
    assertThat(store.claimSettlement(claim("abc", "owner-c")))
        .isEqualTo(SettlementClaimResult.TERMS_CONFLICT);
    store.releaseClaim("abc", "owner-a");
    assertThat(store.claimSettlement(claim("def", "owner-d", "terms"))).isEqualTo(SettlementClaimResult.FRESH);
    assertThat(store.claimSettlement(claim("abc", "owner-e"))).isEqualTo(SettlementClaimResult.FRESH);
  }

  @Test
  void neverReleasesABroadcastOrRejectedClaim() {
    var store = new InMemorySettlementClaimStore();
    store.claimSettlement(claim("sent", "a"));
    store.markSubmitted("sent", "a");
    store.releaseClaim("sent", "a");
    assertThat(store.claimSettlement(claim("sent", "b"))).isEqualTo(SettlementClaimResult.SUBMITTED);

    store.claimSettlement(claim("bad", "c"));
    store.markRejected("bad", "c");
    store.releaseClaim("bad", "c");
    assertThat(store.claimSettlement(claim("bad", "d"))).isEqualTo(SettlementClaimResult.REJECTED);
    store.releaseClaim("missing", "x");
  }

  @Test
  void rejectsANonPositiveCapacity() {
    assertThatThrownBy(() -> new InMemorySettlementClaimStore(0))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("positive integer");
  }

  @Test
  void resultsCarryTheirTypeScriptNames() {
    assertThat(SettlementClaimResult.FRESH.wire()).isEqualTo("fresh");
    assertThat(SettlementClaimResult.IN_FLIGHT.wire()).isEqualTo("in-flight");
    assertThat(SettlementClaimResult.SUBMITTED.wire()).isEqualTo("submitted");
    assertThat(SettlementClaimResult.REJECTED.wire()).isEqualTo("rejected");
    assertThat(SettlementClaimResult.TERMS_CONFLICT.wire()).isEqualTo("terms-conflict");
    assertThat(SettlementClaimResult.CAPACITY_EXCEEDED.wire()).isEqualTo("capacity-exceeded");
    assertThat(InMemorySettlementClaimStore.DEFAULT_MAX_ENTRIES).isEqualTo(4096);
  }

  @Test
  void concurrentClaimsForOneTransactionHaveExactlyOneWinner() throws Exception {
    var store = new InMemorySettlementClaimStore();
    int threads = 16;
    ExecutorService pool = Executors.newFixedThreadPool(threads);
    CountDownLatch start = new CountDownLatch(1);
    List<Future<SettlementClaimResult>> results = new ArrayList<>();
    for (int i = 0; i < threads; i++) {
      String owner = "owner-" + i;
      results.add(
          pool.submit(
              () -> {
                start.await();
                return store.claimSettlement(claim("same", owner, "terms"));
              }));
    }
    start.countDown();
    int fresh = 0;
    for (Future<SettlementClaimResult> r : results) {
      if (r.get() == SettlementClaimResult.FRESH) {
        fresh++;
      } else {
        assertThat(r.get()).isEqualTo(SettlementClaimResult.IN_FLIGHT);
      }
    }
    pool.shutdown();
    assertThat(fresh).isEqualTo(1);
  }
}
