# 125 — Public verify decides by claim state: a submitted claim resumes, a store failure fails closed (implements the 013 amendment)

**Context.** The second R3 review found that refusing every known transaction in public verify (013 as first implemented) breaks the spec's client paid retry after a pending outcome (`scheme_exact_cardano.md:880-882`). Core retries settle only once, in-process. When a resource server surfaces the pending outcome as 402, the client resends the exact `PAYMENT-SIGNATURE`. Verify then answered `duplicate_settlement`: the client paid and was never served.

The review also found that the `try` meant for decode errors also wrapped the store lookup. A store exception was therefore read as "no claim", which fails open.

**Decision.**
- **New SPI query.** `SettlementClaimStore.claimState(txHash) → Optional<SettlementClaimState>`, with states `IN_FLIGHT`, `SUBMITTED`, `SETTLED`, `REJECTED`. It is abstract, with no default. It replaces `isClaimed`, which is removed (the API is unreleased).
- **Public verify by state:**
  - no record → `verifyPayment` (rules 1–9, no evidence shortcut);
  - `SUBMITTED` → `verifyBroadcast` of that exact transaction, the resume verification settle uses: pre-broadcast checks skipped, recipient/asset/amount/method still checked;
  - `IN_FLIGHT`, `SETTLED`, `REJECTED` → `duplicate_settlement`.
- **Exactly one success.** It still holds because every success passes `markSettled`, which only one caller wins.
- **Fail closed.** Only decoding sits inside the `try`. A `claimState` exception gives `isValid: false`, `exact_cardano_settlement_failed`, message `settlement store unavailable`.

**Alternatives.**
- Keep `isClaimed` next to `claimState` (two queries that can disagree).
- Let the client retry go straight to settle (core's HTTP flow verifies first).

**Consequences.** A replay that arrives while the original is `submitted` verifies, so a protected handler may run once per such request; the spec allows this ("MUST tolerate being run once per paid retry"). Its settle answers `duplicate_settlement`, so content is not released on that path. Tests: `ReplayGuardAmendmentTest` (pending → pending → client re-verify valid → one success → duplicates; 6 concurrent verify+settle replays → one success; in-flight/rejected refused; throwing store). The one changed assertion is in `ReplayGuardTest` (WP7 Log).

**Reverse.** Refuse `SUBMITTED` in verify again (breaks the spec retry).
