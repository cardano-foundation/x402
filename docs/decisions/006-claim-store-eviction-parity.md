# 006 — Settlement claim store: TS eviction parity

**Context.** TS `InMemoryCardanoSettlementStore` (4096 entries) clears `inFlight` in `markSubmitted` (`settlementStore.ts:116`), before the confirmation wait. Under capacity pressure it evicts the oldest record that is no longer in flight (`:150-185`). So a submitted but unconfirmed transaction can lose its record, and a retry cannot resume it. Codex rounds 16–17 flagged that the plan overstated "never resubmits".

**Superseded by [013](013-cardano-replay-guard.md) (amendment) and [126](126-claim-retention-until-ttl.md):** the default store no longer mirrors TS eviction. Submitted and settled records are retained until the transaction's TTL + 120 s grace (a deliberate divergence from TS); after that, an evicted transaction can no longer land, or its nonce is already spent. The text below records the original TS-parity decision.

**Earlier, superseded in part by [040](040-eviction-outcome-b-corrected.md):** with an evidence-capable backend (Blockfrost), an already-included transaction's retry ends in success, not failure. The failure case below applies only to backends that cannot read evidence.

**Decision.** Java mirrors TS exactly for the in-memory default, and the plan states the real guarantees:
- A claim taken before broadcast is never evicted.
- While a claim is retained, a retry resumes and never resubmits.
- After a submitted claim is evicted, a retry takes a fresh claim and may resubmit. It resubmits the **identical signed transaction**: same inputs, same hash. So **it can never pay twice.** Possible outcomes:
  - the node treats it as already known → it confirms → success;
  - it is already included → verify sees the nonce spent → a failure response, although the payment landed;
  - the node rejects it as spent → failure, likewise.

The SPI contract recommends that shared stores (JDBC, Redis) keep submitted claims until they are confirmed or rejected, which avoids the misleading failure.

**Alternatives.** Keep submitted claims until resolution in the default too (a Java divergence; memory could fill with pending records, and new claims would then get `capacity-exceeded`).

**Consequences.** Same behaviour as the TS facilitator under load. WP7 tests both post-eviction outcomes.

**Reverse.** Make `evictOldestSettled` skip submitted-but-unresolved records and document the divergence.
