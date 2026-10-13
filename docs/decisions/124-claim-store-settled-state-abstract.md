# 124 — `SettlementClaimStore` gains abstract `markSettled` and `isClaimed` (implements 013)

**Amended by [125](125-public-verify-by-claim-state.md) and [126](126-claim-retention-until-ttl.md):** `isClaimed` is replaced by the abstract `claimState(txHash)` (public verify needs the state, not just presence). Submitted and settled records are retained until TTL + 120 s grace instead of being evictable at once.

**Context.** Decision 013 needs two new answers from the claim store: a terminal `settled` state, and "is there any record for this transaction" for public verify. The coordinator allowed a default method only if third-party stores needed one for source compatibility.

**Decision.** Both are abstract, with no default. A default could not be safe: `isClaimed` defaulting to `false` re-opens the replay, and a no-op `markSettled` lets settled transactions be resumed to success again. No implementation exists outside the module (2.0.0-SNAPSHOT, unreleased). `SettlementClaimResult` gains `SETTLED`.

The in-memory store's semantics:
- `markSettled(txHash, owner)` succeeds once, for the owner of an in-flight claim or for any caller once the claim is submitted. The pending retry resumes under a new owner token. Rejected and already-settled records do not change, and `markSubmitted`/`markRejected` cannot overwrite `settled`.
- Settled records are evictable like any other record no longer in flight. After eviction, rule 5 (spent nonce) refuses the replay.

**Alternatives.** Defaults that throw `UnsupportedOperationException` (fail closed at runtime instead of compile time).

**Consequences.** Third-party stores, such as the plan's JDBC/Redis examples, must implement both methods. The plan §3a level-4 row lists the old result set and methods; it should add `settled`, `markSettled` and `isClaimed` (that row is outside this package's file ownership).

**Reverse.** Remove the methods and the `SETTLED` result together with 013.
