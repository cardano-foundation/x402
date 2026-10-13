# 032 — `HttpProcessResult.RouteUnavailable` and "initialize first"

**Context.** WP4 lists three results (TS shape). WP5 must answer 503 (retryable) or 500 (validation still failing) on affected routes only, using the same snapshot the request is routed with. If the adapter checked `state()` separately before `processHttpRequest`, the two reads could see different states.

**Decision.** `processHttpRequest` reads the published `HttpServerState` once. When the matched route has validation errors it returns a fourth variant, `RouteUnavailable(route, errors, retryable)`; the adapter maps it to 503 + `Retry-After` or 500. Unprotected paths return `NoPaymentRequired` even before `initialize()`; a protected route hit before the first `initialize()` throws `IllegalStateException` (TS adapters initialize lazily; the Spring starter initializes at startup).

**Alternatives.** Let the adapter check `state().errorsFor(route)` (two reads, possible mismatch).

**Consequences.** One more case in the adapters' switch; documented in the class's adapter contract.

**Reverse.** Remove the variant and have adapters check the state.
