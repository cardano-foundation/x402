# 025 — `FacilitatorClient` gains default `verifyTimeout()` / `settleTimeout()`

**Context.** WP4 must warn at startup when an option's worst path (build verify-timeout + failover candidate verify-timeout + 2 × settle timeout) exceeds the 240 s client default. The timeouts belong to each facilitator client.

**Decision.** Two `default` methods on `FacilitatorClient` returning `Duration.ZERO` ("in-process or unknown"); `HttpFacilitatorClient` returns its configured values. Adding default methods is source- and binary-compatible, so the jar the WP7 agent builds against keeps working.

**Alternatives.** `instanceof HttpFacilitatorClient` checks in the HTTP layer (breaks for wrappers and custom clients).

**Consequences.** Custom clients may override them to take part in the budget warning.

**Reverse.** Remove the defaults and the warning's use of them.
