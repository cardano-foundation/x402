# 028 — An unmapped kind fails settle instead of falling back

**Context.** TS settles an unmapped kind by trying every facilitator in order (`:1325-1340`). The plan forbids any settle loop. With a single facilitator the loop would be harmless, but validation at initialize already guarantees every built option has an owner, so the unmapped case is unreachable in normal operation.

**Decision.** If the settle target cannot be determined (no `verifiedBy`, no pin, no owner in the snapshot), `settlePayment` throws `IllegalStateException("No facilitator supports <scheme> on <network> for v<n>")` (TS's message) through the settle-failure hooks. No facilitator is called. The defensive verify loop over all facilitators (TS `:1066-1086`) is kept.

**Alternatives.** Use the only facilitator when exactly one is configured (parity for one client, one more rule).

**Consequences.** `MultiFacilitatorRoutingTest#anUnmappedKindVerifiesOnEveryFacilitatorInOrderButNeverSettlesElsewhere` pins it.

**Reverse.** Add the one-facilitator fallback in `settleTarget`.
