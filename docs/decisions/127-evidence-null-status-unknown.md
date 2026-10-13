# 127 — Transaction evidence with a `null` status is unknown

**Context.** `SettlementEvidence` is a record, so a custom backend can return `new SettlementEvidence(null, n)`. Settle then threw a NullPointerException after `markSubmitted` (the response builder calls `status().wire()`).

**Decision.** The facilitator's single evidence read (`readEvidence`, decision 123) maps both a `null` evidence and a `null` status to `SettlementEvidence.unknown()`. The record itself stays lenient, so existing backends keep compiling and running.

**Alternatives.** `requireNonNull` in the record constructor. The custom backend would then throw inside `getTransactionEvidence`, which the wait loop already tolerates, but other callers would see the exception.

**Consequences.** `ReplayGuardAmendmentTest.evidenceWithoutAStatusIsUnknown`: settle answers `settlement_pending` instead of throwing.

**Reverse.** Drop the status check.
