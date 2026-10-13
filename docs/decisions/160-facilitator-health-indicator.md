# 160 — `x402-facilitator` health component

**Context.** Review round 2, finding 12: plan §3a promises an `x402-facilitator` health indicator with details per network (backend reachable).

**Decision.** `X402FacilitatorHealthIndicator`, bean `x402-facilitatorHealthIndicator` (component `x402-facilitator`):
- active with actuator and the Cardano mechanism on the classpath; `management.health.x402-facilitator.enabled` turns it off;
- probes each network's backend with `getProtocolParameters` (Blockfrost caches it for ten minutes, so probes cost little quota);
- `UP` when every backend answers, `DOWN` when any lookup throws; the error is a detail.

A backend that does not offer parameters (`null`) counts as reachable.

**Test.** `FacilitatorReviewRound2Test#theFacilitatorHealthReportsEachNetworksBackend`. Red first, by compilation.

**Reverse.** Remove the nested `HealthConfiguration`.
