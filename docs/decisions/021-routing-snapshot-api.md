# 021 — `RoutingSnapshot` is public; request paths can pin one snapshot

**Context.** WP3/WP4 require that `initialize()` publishes one immutable routing snapshot with an atomic swap, and that the HTTP layer publishes routing **and** its validation result in one swap, so a request never mixes new routing with an old validation result. If core always read its own current snapshot, a request could build requirements under snapshot N and verify under N+1.

**Decision.**
- `org.x402.core.server.RoutingSnapshot` is a public immutable value (answers, failures, owner map, lookups).
- `X402ResourceServer.sync()` builds a snapshot without publishing; `sync(Duration budget, Executor)` queries facilitators in parallel within a total budget (for WP5's `sync.startup-timeout`) and still applies results in declaration order; `publish(snapshot)` swaps it in; `initialize()` = sync + publish + capability validation (TS shape).
- Request-path methods have overloads taking a snapshot (`buildPaymentRequirements(config, snap)`, `verifyPayment(…, route, snap)`, `settlePayment(…, SettlementRouting)` whose record carries route, `verifiedBy` and snapshot). `null` means "current".
- The HTTP layer keeps its own `HttpServerState(snapshot, validation)` and passes that snapshot through every core call of a request.

**Alternatives.** An opaque attachment on the core snapshot read again by core (still lets a request straddle two snapshots); a request-scoped facade object (one more type for the same effect).

**Consequences.** Slightly larger core API; Spring adapters never need the overloads directly because `X402HttpResourceServer` does the plumbing.

**Reverse.** Make the overloads package-private once a request facade exists.
