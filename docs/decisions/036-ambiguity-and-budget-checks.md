# 036 — Details of the overlap (ambiguity) check and the timeout-budget warning

**Context.** Plan Roles §1b defines both checks; a few inputs were not pinned down.

**Decision.**
- **Routing policy** = the build facilitator (pin, else the kind owner in the new snapshot; `<none>` when there is no owner) plus, when the route has `failover: true`, pinned vs unpinned. Pairs with equal policies are skipped.
- **Overlap:** `scheme`, `network` and effective `maxTimeoutSeconds` are always static; `payTo` is compared when both are static; `asset`/`amount` are compared when both prices are static and parse with the registered scheme (a price that fails to parse counts as "may be equal", failing closed). `extra` = `price.extra` ← option `extra` (the declared values, before facilitator enhancement), minus the scheme's dynamic extra fields; shared keys must be compatible (objects recurse, else deep-equal). Enhancement values (e.g. a facilitator's `feePayer`) are not used, so the check may reject a pair that enhancement would have separated: fail closed.
- **Budget:** per option, build verify-timeout + (route failover and unpinned ? the largest verify-timeout among facilitators whose exact kind, `extra` included, equals the build kind : 0) + 2 × the largest settle timeout among the build facilitator and those candidates. A warning is logged and listed in `HttpServerState.warnings()` above 240 s. Facilitators report timeouts through decision 025 (`Duration.ZERO` = unknown).

**Reverse.** Local to `X402HttpResourceServer`.
