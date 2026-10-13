# 123 — A backend's `null` transaction evidence is read as unknown

**Context.** A custom `CardanoChainBackend` that reports `supportsTransactionEvidence() == true` but returns `null` from `getTransactionEvidence` made `awaitEvidence` throw a NullPointerException after `markSubmitted`. That turned a broadcast payment into an unhandled error. On the submit-failure path, `null` was counted as "landed" (the NPE fell into the lookup-error branch).

**Decision.** All evidence reads go through one helper that maps `null` to `SettlementEvidence.unknown()`. A broadcast with no evidence yet ends in `settlement_pending`. A throwing submit with `null` evidence is "not landed" and is classified as usual (`exact_cardano_settlement_failed`, with the claim retained).

**Alternatives.** Treat `null` as a lookup error (on the submit-failure path that wrongly means "landed").

**Consequences.** `ReviewHardeningTest.nullEvidenceIsReadAsUnknown` covers both paths.

**Reverse.** Call the backend directly again.
