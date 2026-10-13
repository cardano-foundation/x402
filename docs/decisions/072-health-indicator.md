# 072 — `x402` health component

**Decision.** `X402HealthIndicator` (bean `x402HealthIndicator`, `management.health.x402.enabled`): `UP` = ready or no offers, `OUT_OF_SERVICE` = waiting for a failed facilitator (affected routes 503), `DOWN` = re-sync answered but routes invalid (affected routes 500). Details: `facilitators` (each `UP` / `DOWN` with the error / `NOT_SYNCED`), `affectedRoutes`, `warnings`. A failed facilitator no route needs only shows `DOWN` in its detail; the component stays `UP` (plan §1b).

**Reverse.** Local to the indicator.
