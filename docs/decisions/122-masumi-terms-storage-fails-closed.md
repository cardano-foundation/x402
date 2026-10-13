# 122 — Masumi terms binding fails closed when the storage fails (divergence from TS)

**Context.** `ExactCardanoServerScheme.bindMasumiTerms` called `MasumiTermsStorage.updateTerms` outside any `try`. Core swallows exceptions from after-verify hooks, so a storage outage let a verified Masumi payment reach the protected handler without being bound to its quote. That is a fail-open path: one quote could buy several deliveries while the store was down. TS has the same unguarded call; its hook runner behaves alike.

**Decision.** Catch `RuntimeException` around `updateTerms` and abort with `masumi_terms_storage_unavailable` (a Java-only reason; TS has no code for it), message `Masumi terms storage failed: <cause>`. The handler never runs on unbound terms.

**Alternatives.**
- Reuse `masumi_terms_unknown` (it tells the client the quote is unknown, which is false).
- Let the exception propagate (core swallows it, so it fails open).

**Consequences.** A storage outage refuses Masumi payments instead of serving them. `MasumiTermsStorageFailureTest` covers it.

**Reverse.** Remove the try/catch.
