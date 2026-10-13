# 013 — Cardano facilitator: no replay of a landed payment (security divergence from TS)

**Context.** An automated security review of the WP7 port flagged a payment replay. Tracing it in the TS reference (`@x402/cardano` 2.28, `exact/facilitator/scheme.ts:790-830`, `:348-385`) shows TS has the same behaviour:
- **Public `verify()`.** It reads evidence for the transaction, and `acceptedByLedger` becomes true for any transaction already on chain. That skips the TTL and unspent-nonce checks (spec line 814 allows this "for the pending-settlement retry").
- **`settle()`.** A claim in state `submitted` resumes and returns success. No state distinguishes "already reported success".
- **No guard elsewhere.** TS core has no settled-payment memory on the resource-server side.

Consequence: a buyer pays once with transaction T, receives the content, then resends the same `PAYMENT-SIGNATURE` on new requests. Each one verifies (evidence: landed) and settles (resume: success). One payment buys unlimited deliveries while the claim is retained, and after eviction too, via the submit-failure ladder. The spec (`:919`, `:932`) calls the on-chain nonce spend "the authoritative replay guard once the transaction is observable", but rule 5's evidence exception switches that guard off exactly then.

**Decision.** Java diverges from TS here; this is a security fix, not a parity question.
1. **Public `verify()` never treats evidence of ledger acceptance as validity.** It always requires the TTL window and unspent inputs. Any existing claim for the transaction, in any state, means `duplicate_settlement`. The evidence shortcut (`alreadyBroadcast`) exists only inside `settle()`'s resume of its own retained claim.
2. **The claim store gains a terminal `settled` state**, set when this facilitator reports success. Any later `claimSettlement` for that transaction returns `settled`, and `settle()` answers `duplicate_settlement` (TS error code `ERR_DUPLICATE_SETTLEMENT`).
3. **The legitimate pending retry is unchanged.** It is the resource server's second `settle` after `settlement_pending`; it finds `submitted`, resumes, confirms, marks `settled` and returns success.
4. **After eviction,** a retry for an already-included transaction now fails (nonce spent) instead of succeeding. This supersedes outcome (b) of decision 040: a failure report for a payment that landed is acceptable, while a free re-delivery is not.

**Residual risk (documented).** In the in-flight window, several facilitator replicas without a shared claim store can each verify the same mempool transaction (its inputs are not yet spent in the UTxO set). The spec's answer stays: share the store (`SettlementClaimStore` SPI, plan §3a).

**Alternatives.**
- Keep TS parity (ships a known replay).
- A resource-server-side "delivered transactions" set (needs shared state on every resource server; the facilitator fix covers all of them at once).

**Consequences.** TS-exported fixtures that expect `acceptedByLedger` success from public verify are now expected to differ; those test expectations are updated deliberately, with this decision as the reason. The upstream TS reference should be told; the user posts to GitHub.

**Reverse.** Restore evidence acceptance in public verify and resume-to-success for every `submitted` claim.

**Amendment (2026-10-12, after the R3 review of the implementation).**
- **Client resume after pending.** The spec requires that a client may resend the exact same `PAYMENT-SIGNATURE` after a pending outcome and get the same transaction resumed (`scheme_exact_cardano.md:880-882`). Point 1 therefore narrows:
  - public verify refuses `in-flight`, `settled` and `rejected` claims;
  - for a `submitted` claim, it runs the evidence-aware resume verification of that exact transaction.
  Exactly-one-success still holds, because `markSettled` lets only one success win per record.
- **Fail closed.** A claim-store failure during verify makes the payment invalid; it is never treated as "no claim".
- **Retention (divergence from TS eviction, decision 006).** `submitted` and `settled` records are not evicted before the transaction's TTL slot plus the 120 s grace. When nothing else is evictable, a new claim gets `capacity-exceeded`. This closes the window where a mempool-only settled payment could be replayed after eviction, and the case where eviction during the confirmation wait turns the only success into `duplicate_settlement`.
