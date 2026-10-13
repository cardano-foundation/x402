# 131 — `LocalFacilitatorClient` answers exactly what the HTTP path answers

**Context.** WP12: `LocalFacilitatorClient` wraps an in-process `X402Facilitator` and maps `SettleAbortedException` exactly like the handler. `LocalFacilitatorClientTest` asserts that HTTP and local results are identical for valid, invalid, abort and error. Over HTTP, an exception in the facilitator becomes the handler's 500 `{error}`. `HttpFacilitatorClient` turns that into `FacilitatorStatusException("Facilitator verify failed (500): {\"error\":\"…\"}", 500)` (decision 024).

**Decision.**
- Verify and settle go through the same package-private helpers as the handler (`FacilitatorHttpHandler.verify/settle`). An abort becomes `SettleResponse.failure(reason, null, "", requirements.network())`, and the `extensionResponses` side channel is dropped (decision 133).
- Any other `RuntimeException` becomes `FacilitatorStatusException` with status 500 and the HTTP client's exact message (the same TS-style 200-character excerpt). This covers the scheme, hooks, an unregistered network and `getSupported`. The original exception is attached **as the cause**, which the HTTP path cannot carry.
- The identifier is `local` (`IDENTIFIER`) and the class implements `InProcessFacilitatorClient` (decision 098). Timeouts stay `Duration.ZERO` because the call is in process.
- `Error`s are not caught, because neither path can answer them meaningfully.

**Consequences.** The resource server classifies local failures exactly like remote ones. A 500 counts as a transport-level failure for opt-in verify failover (decision 024), and the HTTP layer answers 402. The tests also pin the messages to the ones the TS client recorded (`vectors/facilitator`).

**Alternatives.** Rethrow the original exception. Stack traces would be simpler, but failover and error mapping would then classify local and HTTP failures differently.

**Reverse.** Drop `failure(...)` in `LocalFacilitatorClient`.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
