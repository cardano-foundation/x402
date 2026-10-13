# 126 — Submitted and settled claims are retained until TTL + 120 s grace (divergence from TS eviction, decision 006)

**Context.** The in-memory store evicted any record no longer in flight, oldest first (TS parity, decision 006). Under capacity pressure this had two effects:
1. A settled payment accepted from the mempool (policy `-1` with `acceptMempool`) lost its record while its inputs were still unspent. A replay then verified and "settled" again.
2. Eviction during the confirmation wait (after `markSubmitted`, before `markSettled`) turned the payment's only success into `duplicate_settlement`, because `markSettled` found no record.

**Decision.**
- `SettlementClaim` gains an optional `retainUntilMs`. The 3-argument constructor stays for source compatibility and means "unknown".
- Settle fills it with the POSIX time of the transaction's TTL slot plus the 120 s validity grace (the same grace that closes the validity window).
- `InMemorySettlementClaimStore` evicts only rejected records, or submitted/settled records whose `retainUntilMs` has passed on its `Clock`. Records without a known deadline are never evicted once broadcast; in-flight records never are. When nothing is evictable, a new claim gets `capacity-exceeded`.
- The store takes a `Clock` (`InMemorySettlementClaimStore(int, Clock)`). The options' default store uses the options' clock.
- `markSettled` still returns `false` for a missing record, and never re-creates one.

**Alternatives.**
- TS eviction (both holes stay open).
- Never evict broadcast records (unbounded growth with the memory cap reached sooner).

**Consequences.**
- Under sustained load beyond 4096 live claims, new settles fail with the store-at-capacity message until TTLs pass. That trade is chosen deliberately: refusing a new payment is better than re-delivering an old one.
- A deep policy whose confirmations arrive after TTL + 120 s can still lose its record under pressure. The retry then fails with the nonce spent (a failure for a payment that landed, never a double delivery).
- Shared stores should apply the same retention.
- Tests: `ReplayGuardAmendmentTest` (the mempool replay is refused until the TTL passes; a submitted claim survives pressure and its only success is reported; the store rules).
- Eviction-dependent WP7 tests now pass a store clock past retention (`AFTER_RETENTION`), or claims with an elapsed `retainUntilMs`. These setup changes are listed in the WP7 Log.

**Reverse.** Make `Record.evictable` return `!inFlight` again.
