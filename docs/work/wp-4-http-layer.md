# WP-4: the framework-agnostic HTTP layer matches TS processHTTPRequest/processSettlement; the java.net.http client pays and retries
Tier: R2
Base: <git rev-parse HEAD at package start>
Check: `RoutePatternParityTest`, `RouteValidationTest`, `HttpFacilitatorRoutingTest`, `HttpResourceServerTest`, `HttpSettlementTest`, `HttpFacilitatorClientTest` (WireMock), `X402HttpClientTest` (asserts the client default timeout ≥ the worst-case server budget with defaults and failover) pass

## Allowed files
- java/x402-core/src/main/java/org/x402/http/**
- java/x402-core/src/main/resources/org/x402/http/**
- java/x402-core/src/test/java/org/x402/http/**
- java/x402-core/src/test/resources/vectors/**
- java/tools/ts-vectors/**
- docs/**

## Rules
- `HttpRequestContext` carries method, `path`, `decodedPath`, headers, URL and adapter. `path` is the **raw** (not decoded) path within the application, with the context path removed and `;` parameters stripped. `decodedPath` is passed separately. TS normalizes and matches both forms (:1256-1263, :1419-1433).
- `X402HttpResourceServer(resourceServer, RouteResolver)`:
  - `processHttpRequest(ctx)` → sealed `HttpProcessResult`:
    - `NoPaymentRequired`
    - `PaymentVerified{paymentPayload, paymentRequirements, declaredExtensions, beforeHandlerSettlement, cancellationDispatcher}`
    - `PaymentError{status, headers, body}`
    - mirrors TS :304-314
    - Java addition: `RouteUnavailable{route, errors, retryable}` when the matched route failed validation in the published state (adapter: 503 + `Retry-After` if retryable, else 500; decision 032)
  - `processSettlement(...)`; `createSettlementHeaders` / `createFailurePathSettlementHeaders` (:926, :961)
- Behaviour = TS `x402HTTPResourceServer.ts:528-755`:
  - protected-request hook: grant skips payment, abort → 403
  - unpaid → 402 with `PAYMENT-REQUIRED` and `Cache-Control: no-store`, body `{}` or unpaidResponseBody
  - browser (Accept contains text/html AND UA contains Mozilla) → PaywallProvider
  - malformed signature → unpaid 402
  - no matching requirements → 402; verify invalid → 402 with invalidReason
  - `skipHandler` → settle inline, 200 (:685-692)
  - `settleBeforeHandler` flows (:697-721)
  - `FacilitatorResponseException` for adapters → 502
  - settle failure → 402 + `PAYMENT-RESPONSE` + settlementFailedResponseBody
  - `Settlement-Overrides` read, then stripped
- **Adapter contract, documented on the class and used by WP5/WP6:**
  - On handler status ≥ 400 or an exception: call `cancellationDispatcher.cancel(handler_failed)`, set the failure-path headers, strip `Settlement-Overrides`, and skip settle (TS `express/src/index.ts:313-371`).
  - Otherwise: settle, then release the body.
- **Route validation at initialize** (TS `x402HTTPResourceServer.ts:443-448`, `:486-495`, `:1118-1228`):
  - `X402HttpResourceServer.initialize()` runs the resource-server initialize, then `validateRouteConfiguration`, and throws `RouteConfigurationError` listing every error (missing scheme, unsupported assetTransferMethod/paymentFlow, missing facilitator kind).
  - Constructor check for flows without a facilitator.
  - `isFatalStartupError(e)` mirrors TS `backgroundInit.ts:14-16`.
  - Also exposes whether any facilitator failed during sync, so adapters can apply the partial-outage rule (plan Roles §1).
  - Every `initialize()` (startup and each re-sync) re-runs the full validation, ambiguity check included, against the new owners. Routing snapshot and validation result are published as **one** immutable `HttpServerState` in a single atomic swap, so a request never sees new routing with an old validation result.
  - Validation names the facilitator and the option index for pin errors (unknown identifier, pinned facilitator lacks the kind or capability). These are entries of the `RouteConfigurationError` (reasons `unknown_facilitator`, `missing_facilitator`, `facilitator_capability`), each marked `retryable` when only a failed facilitator could heal it (decision 031). Pins match only effective identifiers (explicit `identifier`, else the url without trailing slashes); pins to the generated `local` entry are valid.
  - For every pair of options in a route with a different routing policy (build facilitator, or pinned vs unpinned when the route has `failover: true`), it runs the **overlap** test of plan Roles §1b: all core fields (`scheme`, `network`, `amount`, `asset`, `payTo`, `maxTimeoutSeconds`) equal or possibly equal (ref-based), and `extra` compatible (shared keys recurse for objects, else deep-equal; dynamic extra fields omitted) → error. Tests: one `price-ref` over preprod + mainnet with different pins starts; two same-network accounts with different static `pay-to` and different pins start; equal core fields with `extra` `{a:1}` vs `{b:2}` fail (union payload); with `failover: true`, identical options owned by A, one pinned to A and one unpinned, fail.
  - Errors are classified per route, so adapters can scope partial-outage 503s to affected routes only.
- **Facilitator routing through the HTTP flow:**
  - `RouteConfig.failover` (boolean) and `PaymentOption.facilitator` select the `FacilitatorRoute` for the matched option
  - `PaymentVerified` carries `verifiedBy`
  - `processSettlement` passes it on, so settle and the pending retry hit the same facilitator
  - `HttpFacilitatorRoutingTest`
  - `RouteValidationTest`.
- `RouteResolver` SPI. The default `PatternRouteResolver` ports `parseRoutePattern` (:1373-1402) and `normalizePath` (:1410-1434), checked against the WP2 vectors.
- `HttpFacilitatorClient`:
  - default URL https://x402.org/facilitator, **default timeout 90 s** (TS `httpFacilitatorClient.ts:16`)
  - POST /verify, POST /settle, GET /supported
  - per-endpoint auth headers via `FacilitatorAuthProvider`
  - 429 backoff on /supported (:512-574)
- Pending-retry timing: a test with a fake facilitator that answers pending, then success, shows the end-to-end time stays within the client default.
- `PaywallProvider` SPI + bundled static fallback HTML (no interpolation, TS :383-401).
- `X402HttpClient` wraps `java.net.http.HttpClient`: on 402, decode, select, pay and retry once. `X402HttpClient.wrap(HttpClient delegate, X402Client client[, HostPolicy])` returns a `java.net.http.HttpClient` subclass delegating every other method, so existing code keeps its type. It pays any host unless a `HostPolicy` is given; `HostPolicy` (exact / `*.domain`) is shared with the Spring allowlist. Bodies: the wrapper records the request body while the first request is sent (a recording `BodyPublisher` around the original), up to `max-replay-body` (default 1 MiB). It retries with the recorded bytes. Over the limit → the 402 is returned unpaid, decided before signing. With a `HostPolicy`, the delegate must have `followRedirects() == NEVER` (`IllegalArgumentException` otherwise). The wrapper follows 3xx itself and checks each destination host before sending, so a paid retry is never sent to an off-list host; it also checks `PAYMENT-REQUIRED.resource.url`. A test proves that an off-list redirect target never receives `PAYMENT-SIGNATURE`. `X402HttpClientTest` covers wrap, host policy, redirect to an off-list host, and an oversized body. Its default request timeout is 240 s, above the 210 s worst case (2 × 15 s verify with one failover hop, plus 2 × 90 s settle). `X402HttpResourceServer.initialize()` warns when any option's worst path exceeds 240 s: build verify-timeout + (failover ? max candidate verify-timeout : 0) + 2 × max settle timeout over the build facilitator and the candidates (4 × for escrow options, decision 097). A test uses A at 15 s and candidate B at 120 s verify-timeout (315 s → warning).

## Proof commands
- red-first: ~/.claude/bin/red-first.sh <Base> --setup 'mvn -q -f java/pom.xml install -DskipTests' java/x402-core/src/test/java/org/x402/http/RoutePatternParityTest.java java/x402-core/src/test/java/org/x402/http/RouteValidationTest.java java/x402-core/src/test/java/org/x402/http/HttpFacilitatorRoutingTest.java java/x402-core/src/test/java/org/x402/http/HttpResourceServerTest.java java/x402-core/src/test/java/org/x402/http/HttpSettlementTest.java java/x402-core/src/test/java/org/x402/http/HttpFacilitatorClientTest.java java/x402-core/src/test/java/org/x402/http/X402HttpClientTest.java -- mvn -f java/pom.xml -pl x402-core test
- green: `mvn -B -f java/pom.xml -pl x402-core verify -Pcoverage checkstyle:check spotbugs:check`
- scope: ~/.claude/bin/check-scope.sh docs/work/wp-4-http-layer.md

## Log
- 2026-10-12, red-first (manual, decision 001): all 7 Check tests written first (`RoutePatternParityTest`, `RouteValidationTest`, `HttpFacilitatorRoutingTest`, `HttpResourceServerTest`, `HttpSettlementTest`, `HttpFacilitatorClientTest` (WireMock), `X402HttpClientTest` (WireMock)) plus helpers `TestAdapter`, `HttpTestSupport`; `mvn -B -pl x402-core test` → COMPILATION ERROR, 200 errors (`package HttpProcessResult does not exist`, `HttpFacilitatorClient`, `FacilitatorAuthProvider`, `ProcessSettleResult`, … do not exist).
- Built (main, `org.x402.http`): `X402HttpResourceServer` (processHttpRequest / processSettlement / settlement header helpers / initialize + validation + `HttpServerState` swap / `isFatalStartupError`, adapter contract in its Javadoc), `HttpServerState`, `HttpProcessResult` (+ `RouteUnavailable`), `ProcessSettleResult`, `HttpResponseInstructions`, `RouteValidationError`, `RouteConfigurationError`, `RouteResolver`, `RouteMatch`, `PatternRouteResolver`, `RoutePattern` (TS `parseRoutePattern`/`normalizePath`/`normalizeDecodedPath` incl. a JS-exact `decodeURIComponent`), `HttpAdapter`, `HttpRequestContext`, `HttpTransportContext`, `RouteConfig`, `PaymentOption`, `DynamicPayTo`, `DynamicPrice`, `HttpResponseBody`, `UnpaidResponseBody`, `SettlementFailedResponseBody`, `ProtectedRequestHook`, `HttpResourceServerExtension`, `PaywallProvider`, `PaywallConfig`, `HttpFacilitatorClient`, `FacilitatorAuthProvider`, `X402HttpClient`, `HostPolicy`; resource `org/x402/http/fallback-paywall.html`. No new TS vectors were needed (`RoutePatternParityTest` uses the WP2 `route-patterns.json`).
- First run after implementation: all 7 Check classes green (78 tests) without test changes.
- Two gaps found in self-review, each fixed test-first: (1) decision 049 (WP7) — the Masumi issuer needs the paid payload on paid-path 402s: `PaidPathEnrichmentTest` red (`expected: PaymentPayload[…] but was: null`), then `processHttpRequest` passes the payload (decision 038). (2) JDK 21 `HttpClient` lifecycle not delegated by the Java-17-compiled wrapper: `X402HttpClientLifecycleTest` red (compile: `isTerminated()`/`awaitTermination` missing, not `AutoCloseable`), then delegated by reflection + `AutoCloseable` (decision 039).
- Green: `cd java && mvn -B -pl x402-core verify -Pcoverage checkstyle:check spotbugs:check` → exit 0; 266 tests (WP2 59 + WP3 127 + WP4 80), 0 failures; coverage instructions 0.943, branches 0.815; 0 checkstyle violations; 0 SpotBugs bugs. Only compiler warning: pre-existing WP2 `HookResults.java:66` unchecked conversion (signature frozen).
- Decisions: 031 (classified validation errors; pin/capability inside `RouteConfigurationError`; plan §1b wording updated), 032 (`RouteUnavailable`; initialize first), 033 (fallback paywall text), 034 (`X402HttpClient` details), 035 (`HttpFacilitatorClient` transport), 036 (overlap + budget details, fail closed), 037 (HTTP type shapes), 038 (paid payload to scheme enrichment), 039 (JDK 21 lifecycle delegation).
- TS deviations (documented): a non-x402 402 passes through `X402HttpClient` (TS throws); "Payment already attempted" is checked before signing; connection errors answer 502 (decision 024); a pinned facilitator lacking a kind is a `RouteConfigurationError` entry; route errors surface per request as `RouteUnavailable`; `Retry-After` HTTP dates only in RFC 1123 form.
- 2026-10-12 (orchestrator, automated security review): `X402HttpClient` copied all headers when following a redirect itself, so `Authorization`/`Cookie`/`PAYMENT-SIGNATURE` reached another origin. red-first (manual, decision 001): new `X402HttpClientRedirectHeadersTest.crossOriginRedirectDropsCredentialHeaders` failed (Authorization/Cookie/X-Api-Key present at the other origin). Fix: a cross-origin hop (scheme, host or port differs) drops authorization, cookie, proxy-authorization, x-api-key, payment-signature, x-payment; same-origin keeps them (decision 012). Gate: `mvn -B -pl x402-core verify -Pcoverage checkstyle:check spotbugs:check` → exit 0, 268 tests.

- 2026-10-12, review round (coordinator): red-first (manual, decision 001) for the HTTP-layer findings: `mvn -B -pl x402-core test -Dtest=X402HttpClientPaidRetryTest,RouteValidationReviewTest,HttpFacilitatorClientRedirectTest` → 8 run, 7 failures + 1 error: B1 `anOffListFirstHost…` "Expected exactly 0 requests … but received 1" (signature sent to the off-list first host); O3 `anEmptyRequestBodyIsReplayable` "expected: 201 but was: 402"; S1 "expected RouteConfigurationError"; S2 pinned-elsewhere threw `RouteConfigurationError`, S2 retryable "Expecting value to be true but was false"; O1 no skipHandler warning record; O2 "Expected size: 1 but was: 0" (no escrow budget warning); O5 `FacilitatorStatusException … (404)` (the 307 was followed to another host).
- Review round fixes, all red first (see the entry above), each now green:
  - B1: with a `HostPolicy` the paid retry goes to the URI that answered 402 (`X402HttpClientPaidRetryTest#anOffListFirstHost…`, decision 095).
  - O3: an empty body is replayable (`#anEmptyRequestBodyIsReplayable`, decision 095).
  - S1: the overlap check compares wire-form `extra` (`RouteValidationReviewTest#s1…`, decision 096).
  - S2: core-level capability problems are reported only for kinds no option uses; capability and ambiguity errors are retryable when a facilitator failed and the option is unpinned or its pin failed (`#s2…` ×2, decision 096). This is narrower than the review's wording, so that the immutable `RouteValidationTest#aCapabilityProblemOfAnUnusedSchemeIsStillFatal` (TS parity) holds.
  - O1: WARNING plus Javadoc for skip-handler on upfront (`#o1…`, decision 097).
  - O2: escrow counts 4 × settle in the budget (`#o2…`, decision 097; plan §1b and this WP's rule text updated).
  - O5: the facilitator client does not follow redirects; a 3xx throws `FacilitatorResponseException` (`HttpFacilitatorClientRedirectTest`, decision 099).
  - The orchestrator's `X402HttpClientRedirectHeadersTest` (decision 012) stays green.
- Review round, B2 scope review (decision 001 replaces check-scope.sh). `git status --short` cannot separate packages because nothing is committed, so the files changed since WP3 started (mtime ≥ 16:39) were listed. Under `java/x402-core` they are `src/main/java/org/x402/http/**` (29 files), `src/main/resources/org/x402/http/**` (1 file) and `src/test/java/org/x402/http/**` (15 files); all are inside this package's Allowed globs. The orchestrator also edited `X402HttpClient.java` and added `X402HttpClientRedirectHeadersTest.java` there (decision 012). No vector files or `java/tools/ts-vectors/*` were changed by WP4. WP4 docs: decisions 031–039, 095–097, 099, the README lines, plan §1b (two bullets), and this file.
- Review round green: `cd java && mvn -B -pl x402-core verify -Pcoverage checkstyle:check spotbugs:check` → exit 0; 279 tests, 0 failures; coverage instructions 0.942, branches 0.817; 0 checkstyle violations; 0 SpotBugs bugs.
- 2026-10-12 (orchestrator, follow-up to Spring decision 149): with a `HostPolicy`, `X402HttpClient` paid a 402 without `resource.url`. red-first (manual, decision 001): new `X402HttpClientResourceUrlTest.aMissingResourceIsReturnedUnpaid` failed (2 requests: it paid). Fix: a missing or unparsable resource URL fails closed (decision 015). Gate: `mvn -B -pl x402-core verify -Pcoverage checkstyle:check spotbugs:check` → exit 0, 333 tests.
