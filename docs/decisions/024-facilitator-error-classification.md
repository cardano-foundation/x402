# 024 — Facilitator error classification: status errors vs transport errors

**Context.** Plan Roles §1b allows verify failover only on transport-level failures: no response, timeout, HTTP 5xx or 429 **without** an `isValid` body. TS `HTTPFacilitatorClient` throws `VerifyError`/`SettleError` for error statuses with a verdict body, a plain `Error("Facilitator verify failed (503): …")` for error statuses without one, and `FacilitatorResponseError` (incl. `FacilitatorTimeoutError`) for timeouts and unusable 2xx bodies. A `fetch` network error is also a plain `Error`. In the TS HTTP layer only `FacilitatorResponseError` becomes a 502; plain errors become a 402.

**Decision.**
- New `org.x402.core.FacilitatorStatusException(message, statusCode)` = TS's plain `Error` for a non-2xx without verdict (same message). HTTP layer: 402 path, as in TS.
- `FacilitatorResponseException` (existing) covers timeouts (`Timeout`, status 0), connection failures (status 0; **Java choice**: TS would answer 402 on a `fetch` failure, the plan's response rule 6 says "facilitator transport error: 502") and unusable 2xx bodies (status 200). HTTP layer: rethrown → 502.
- Failover predicate (`X402ResourceServer.isTransportFailure`): `FacilitatorResponseException` with status 0, 429 or ≥ 500; `FacilitatorStatusException` with 429 or ≥ 500. `VerifyException` (any status), other 4xx and unusable 2xx bodies are final.

**Alternatives.** Map everything non-verdict to `FacilitatorResponseException` (a 5xx would then answer 502 instead of TS's 402); classify by message text (brittle).

**Consequences.** One additive core exception type. A refused connection answers 502 in Java and 402 in TS: a documented divergence.

**Reverse.** Throw `FacilitatorStatusException(…, 0)` for connection errors to restore TS's 402.
