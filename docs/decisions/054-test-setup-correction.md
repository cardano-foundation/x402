# 054 — A test setup defect corrected after red-first

**Context.** Tests are immutable once their red-first run is logged. `SettlementFlowTest.aSubmitterReportingAnotherHashIsAFailureThatKeepsTheClaim` used a backend without evidence read and the default policy (`l1Confirmations: 1`). TS and Java both correctly refuse that combination in verify (`evidence_unavailable`) before anything is submitted, so the test could not reach the behaviour it is named after, for any correct implementation.

**Decision.** The test now uses `l1Confirmations: 0` for that case (the only depth such a backend can settle). Its assertions are unchanged: settlement failed with the submitter-hash message, the claim is kept (the retry is not a duplicate), exactly one submission. This does not weaken it: every original assertion still runs, now against the code path it names.

**Alternatives.** Keep the test failing (blocks the gate); delete it (loses the check).

**Consequences.** Recorded in the WP7 log next to the red-first entry.

**Reverse.** n/a.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking; flagged for user sign-off in the final report.
