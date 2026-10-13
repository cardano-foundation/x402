# 046 — Optional TS signer members become default methods with capability answers

**Context.** TS changes behaviour on the mere presence of optional signer members: `getTransactionEvidence` (advertised maximum depth, resume by evidence), `validatePhase1Transaction` (accept balance-changing bodies), `getProtocolParameters` (fee floor, min-UTxO), `evaluateTransaction`, `isDefinitiveSubmissionRejection`, `waitForConfirmation`.

**Decision.** Default methods on `CardanoChainBackend`: `supportsTransactionEvidence()` with `getTransactionEvidence`; `supportsPhase1Validation()` with `validatePhase1Transaction`; `getProtocolParameters` returning `null` for "not offered" (a throw means "lookup failed", as in TS); `evaluateTransaction` and `waitForConfirmation` default to no-ops; `isDefinitiveSubmissionRejection` defaults to `false`. Same spirit as decision 010.

**Alternatives.** Separate capability interfaces (`instanceof` checks); `Optional` returns.

**Consequences.** A custom backend implements four methods and opts into the rest.

**Reverse.** Extract interfaces; keep the defaults for source compatibility.
