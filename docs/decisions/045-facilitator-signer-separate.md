# 045 — The facilitator's addresses come from a separate optional signer

**Context.** TS `FacilitatorCardanoSigner` mixes provider calls and `getAddresses`. The plan defines `ExactCardanoFacilitatorScheme(chainBackend, signer?, options)`, where "a null signer means provider-only, and getSigners returns an empty list", but it also lists `getAddresses` among the `CardanoChainBackend` methods.

**Decision.** `CardanoChainBackend` has the provider methods only. The addresses come from `CardanoFacilitatorSigner` (`getAddresses()`, `ofAddresses(...)`, `fromMnemonic(...)`), the scheme's optional second argument. `getSigners` returns its addresses, or an empty list when it is `null`.

**Alternatives.** Keep `getAddresses` on the backend too (two sources of the same answer, needing a precedence rule).

**Consequences.** WP12/WP13 build one backend per network and, when a mnemonic is configured, a signer from it.

**Reverse.** Add a default `getAddresses()` to the backend and consult it when the signer is `null`.
