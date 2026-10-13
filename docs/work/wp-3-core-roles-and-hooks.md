# WP-3: core roles run verify/settle with hooks, scheme hooks, payment flows, cancel dispatch and pending retry
Tier: R2
Base: <git rev-parse HEAD at package start>
Check: `FacilitatorHooksTest`, `ResourceServerLifecycleTest`, `SnapshotSwapTest`, `FacilitatorPinningTest`, `VerifyFailoverTest`, `SchemeHooksTest`, `PendingSettleRetryTest`, `MultiFacilitatorRoutingTest`, `ClientSelectionTest`, `SpendControlsTest`, `FacilitatorRoutingTest`, `HooksTest`, `PaymentFlowTest` pass against in-test fake schemes

## Allowed files
- java/x402-core/src/main/java/org/x402/core/**
- java/x402-core/src/test/java/org/x402/core/**
- docs/**

## Rules
- Mirror TS `typescript/packages/core/src/server/x402ResourceServer.ts` and Go `go/server.go`:
  - register :374, registerExtension :462, initialize :644
  - buildPaymentRequirements :761, buildPaymentRequirementsFromOptions :842, createPaymentRequiredResponse :890
  - verifyPayment :1002, settlePayment :1197
  - default maxTimeoutSeconds 300
- **Hooks:**
  - onBeforeVerify (abort / skip), onAfterVerify, onVerifyFailure
  - onBeforeSettle: abort → settle error 400
  - onAfterSettle, onSettleFailure, onVerifiedPaymentCanceled
  - A throwing after-hook or before-verify hook logs a warning and does not fail the request (TS :1027-1046).
- **Scheme hooks:** run alongside global hooks for the matching scheme. An onAfterVerify abort fails the verification and dispatches verified-payment-canceled (TS :1688-1701). `SchemeHooksTest` proves the abort → invalid + cancel-once path.
- **Pending retry:** port `settleWithPendingRetry` (TS :1577, called at :1331 and :1352). A `settlement_pending` result is retried exactly once. `PendingSettleRetryTest` uses a fake scheme that returns pending, then success.
- **Payment flows** per `core/src/server/paymentFlow.ts:18-34` (authorization / upfront / escrow); the scheme default is overridable by `extra.assetTransferMethod`; `skipHandler` directive supported.
- **Multiple facilitator clients** (TS `x402ResourceServer.ts:352-363`, `:644-711`, `:1922-1932`):
  - facilitators are a list in declaration order (`builder.facilitators(List<FacilitatorClient>)`, TS/Go/Python shape); each client exposes `identifier()`, defaulting to its url (Go/Python parity); duplicates → `IllegalArgumentException`
  - `initialize()` reads each `/supported`; results are applied in declaration order; the first facilitator listing an exact (version, network, scheme) kind owns it; wildcard handling is limited as described in the caveats below
  - a client failure warns and continues; zero kinds loaded → error
  - verify with no mapping falls back to trying every client in order (TS :1066-1086, defensive only); **settle never does**: it goes to the settle target (plan Roles §1b) and nowhere else, a deliberate divergence from TS `:1325-1340`. `MultiFacilitatorRoutingTest` asserts that a settle timeout on the target is not retried elsewhere
  - wildcard caveats (TS `utils/index.ts:131-145`, `x402ResourceServer.ts:733-735`): an exact network key beats a wildcard regardless of order; an exact key without the scheme does not fall back to the pattern; wildcard kinds cannot build requirements
  - `initialize()` reports which facilitators failed, so the HTTP layer can tell fatal from retryable (plan Roles §1)
  - `validateFacilitatorCapabilities` + `FacilitatorCapabilityError` (TS :1607-1632)
  - `MultiFacilitatorRoutingTest` covers all of the above
- **Pinning** (plan Roles §1b, Java extension):
  - the option's pin: `ResourceConfig.facilitator` in core, `PaymentOption.facilitator` in the WP4 HTTP layer (decision 027) (optional name; never serialized into requirements)
  - `buildPaymentRequirements` uses the option's **build facilitator** (the pin, else the kind owner): its exact kind for `enhancePaymentRequirements`, its `validateFacilitatorSupport`, and its extensions (TS `x402ResourceServer.ts:780-798`)
  - reserved identifier `local`
  - `verifyPayment` / `settlePayment` take a `FacilitatorRoute` (`Pinned(identifier)` | `Auto` | `AutoWithVerifyFailover`)
  - pinned → only that facilitator; unknown identifier → `IllegalArgumentException` at registration time
  - `FacilitatorPinningTest`
- **Verify failover** (Java extension, opt-in):
  - `AutoWithVerifyFailover`: on a transport-level failure of the build facilitator (connection error, timeout, HTTP 5xx or 429 **without** an `isValid` field), retry `/verify` **once** on the next facilitator in declaration order whose kind, `extra` included, equals the build kind
  - any body with `isValid` (whatever the status) and any 4xx other than 429 is final (TS `httpFacilitatorClient.ts:434-436`); a 429 without `isValid` fails over
  - per-facilitator `verifyTimeout` (default 15 s), separate from the settle/supported timeout (90 s)
  - the verify result carries `verifiedBy` (facilitator identifier)
- **Settle target:** `verifiedBy`, else the pin, else the build facilitator. This covers verify skipped by a hook or a `verifyBeforeHandler=false` flow (TS `:1036-1054`).
  - Settle and the pending retry use exactly that facilitator; **no settle loop**. This is a documented divergence from TS's unmapped-kind settle loop (`:1325-1340`).
  - The verify-side unmapped-kind loop (`:1066-1086`) stays as a defensive path.
- `VerifyFailoverTest` covers:
  - one-hop failover; candidates with a different kind `extra` skipped; settle follows the verifier
  - no failover on an `isValid` body (any status), a 4xx other than 429, a pinned option, or a settle error; a separate case asserts that a 429 without `isValid` fails over
  - a skip-verify hook and an upfront flow with failover on settle at the pin / build facilitator
- `FacilitatorPinningTest` covers two facilitators with different kind `extra`: the pinned option's requirements carry the pinned facilitator's values.
- **`X402Client`** (TS `client/x402Client.ts`): register(network, scheme), registerPolicy, custom selector (default: first). `selectPaymentRequirements` runs the TS pipeline (:777-847):
  1. keep registered network + scheme
  2. drop unknown paymentFlow
  3. spend controls
  4. policies, in order (an empty result throws)
  5. prefer authorization/null flow
  6. selector
- **Spend controls** (TS `x402Client.ts:156`, `:170-192`, `:858-898`):
  - On by default. Only assets recognized by the scheme's `findDefaultAsset` pass (on Cardano that is USDM only), capped at $1 per payment.
  - `allowedAssets` is either `true` (any asset) or a list of `{network, asset, maxAmountPerPayment (atomic)}`.
  - `maxAmountPerPayment` is the USD cap; spend controls can be disabled entirely.
  - All requirements rejected → error with TS's message.
  - `SpendControlsTest`:
    - lovelace refused by default
    - lovelace accepted via an `allowedAssets` entry, and capped by that entry
    - `allowAnyAsset`
    - disabled
    - $1 cap on USDM
- **Built-in policies:** `PaymentPolicies.preferNetwork`, `preferScheme` (Python `client_base.py:338-363` parity) and `maxAmount(asset, amount)` (a Java extension; Python's `max_amount` has no asset). `preferNetwork(a, b)` makes `a` most preferred.
- **Client hooks:** onBeforePaymentCreation, onAfterPaymentCreation, onPaymentCreationFailure, onPaymentResponse (TS :464-488, Go `client.go:155-181`).
- **`X402Facilitator`** (TS `facilitator/x402Facilitator.ts`):
  - register(networks, scheme), registerExtension
  - verify/settle routed to the first registered scheme matching scheme + network
  - getSupported → kinds, extensions, signers (from `getSigners`)
  - hooks onBefore/AfterVerify, onVerifyFailure, onBefore/AfterSettle, onSettleFailure, with TS semantics:
    - a before-verify abort returns `isValid:false` + reason (TS `:293-300`)
    - failure hooks may recover, and after-hooks then run with the recovered result (TS `:353-360`)
  - schemes receive a `FacilitatorContext` exposing `getExtension(key)`; registered extension keys appear in `getSupported().extensions`
  - `InMemoryPendingSettlementStore` {get, set, delete} (5 min TTL, TS `PENDING_SETTLEMENT_TTL_MS`), thread-safe
  - `FacilitatorHooksTest` covers abort, recover, context lookup, `/supported` extension keys, delete and TTL expiry
  - a before-settle abort throws `SettleAbortedException(reason)`, as TS throws `Settlement aborted: …` (`x402Facilitator.ts:415-419`) and Go returns `SettleError`; mapping to a wire body is WP12's job
- Synchronous API (plan decision 1). Registration only before the first `initialize()` (IllegalStateException afterwards).
- **Snapshot semantics:** `initialize()` may be called again (re-sync). Each call builds a new immutable routing snapshot (facilitator map, supported kinds, failed-facilitator set) and publishes it with one atomic reference swap; it never mutates a published snapshot. Concurrent `initialize()` calls are allowed and the last publish wins. Single-flight is the adapter's job (WP5), and the Javadoc tells non-Spring callers to serialize their `initialize()` calls, because overlapping calls can install stale data.
- `SnapshotSwapTest`: verify and settle running concurrently with repeated `initialize()` calls never see a partial map.

## Proof commands
- red-first: ~/.claude/bin/red-first.sh <Base> --setup 'mvn -q -f java/pom.xml install -DskipTests' java/x402-core/src/test/java/org/x402/core/FacilitatorHooksTest.java java/x402-core/src/test/java/org/x402/core/ResourceServerLifecycleTest.java java/x402-core/src/test/java/org/x402/core/SnapshotSwapTest.java java/x402-core/src/test/java/org/x402/core/FacilitatorPinningTest.java java/x402-core/src/test/java/org/x402/core/VerifyFailoverTest.java java/x402-core/src/test/java/org/x402/core/SchemeHooksTest.java java/x402-core/src/test/java/org/x402/core/PendingSettleRetryTest.java java/x402-core/src/test/java/org/x402/core/MultiFacilitatorRoutingTest.java java/x402-core/src/test/java/org/x402/core/SpendControlsTest.java java/x402-core/src/test/java/org/x402/core/ClientSelectionTest.java java/x402-core/src/test/java/org/x402/core/FacilitatorRoutingTest.java java/x402-core/src/test/java/org/x402/core/HooksTest.java java/x402-core/src/test/java/org/x402/core/PaymentFlowTest.java -- mvn -f java/pom.xml -pl x402-core test
- green: `mvn -B -f java/pom.xml -pl x402-core verify -Pcoverage checkstyle:check spotbugs:check`
- scope: ~/.claude/bin/check-scope.sh docs/work/wp-3-core-roles-and-hooks.md

## Log
- 2026-10-12, red-first (manual, decision 001): all 13 Check tests written first (`FacilitatorHooksTest`, `ResourceServerLifecycleTest`, `SnapshotSwapTest`, `FacilitatorPinningTest`, `VerifyFailoverTest`, `SchemeHooksTest`, `PendingSettleRetryTest`, `MultiFacilitatorRoutingTest`, `ClientSelectionTest`, `SpendControlsTest`, `FacilitatorRoutingTest`, `HooksTest`, `PaymentFlowTest`) plus test fakes (`Fixtures`, `FakeFacilitatorClient`, `FakeServerScheme`, `FakeClientScheme`, `FakeFacilitatorScheme`); `mvn -B -pl x402-core test` → COMPILATION ERROR, 200 `cannot find symbol` errors (`org.x402.core.server.X402ResourceServer`, `org.x402.core.client.X402Client`, `org.x402.core.facilitator.X402Facilitator`, … do not exist).
- Built (main): `org.x402.core.server.{X402ResourceServer, RoutingSnapshot, ResourceConfig, FacilitatorRoute, SettlementRouting, ServerVerifyResult, SettlementOverrides, CompletedSettlement, CancelOptions, PaymentCancellationDispatcher, PaymentFlows, ResourceServerExtension, ExtensionValidation, FacilitatorCapabilityError, HookPolicy, Identifiers}`, `org.x402.core.facilitator.{X402Facilitator, InMemoryPendingSettlementStore}`, `org.x402.core.client.{X402Client, SpendControls, PaymentPolicy, PaymentPolicies, PaymentRequirementsSelector, X402ClientException}`, `org.x402.core.utils.{Networks, JsonValues}`, `org.x402.core.FacilitatorStatusException`; additive `FacilitatorClient.verifyTimeout()/settleTimeout()` defaults; `PaymentFlow.ESCROW` phase fix.
- First test run after implementation: one test-side compile slip fixed mechanically (`PendingSettleRetryTest`: AssertJ `singleElement().hasMessage(..)` → `singleElement().extracting(Throwable::getMessage).isEqualTo(..)`, same assertion); then all 13 Check classes green.
- First green attempt failed the coverage gate (branches 0.71 < 0.75). Added coverage tests **after** implementation (not red-first; they pin existing TS-parity behaviour): `ExtensionEchoTest` (TS `validateExtensions`, builder-code rules), `MutationPolicyTest` (TS `hookPolicy.ts` messages, JSON comparisons), `ClientExtensionMergeTest` (TS `mergeExtensions`). Writing `ExtensionEchoTest` exposed one parity bug, fixed: a JSON `null` echo of a server-owned field must count as present (TS skips only `undefined`).
- Green: `cd java && mvn -B -pl x402-core verify -Pcoverage checkstyle:check spotbugs:check` → exit 0; 186 tests, 0 failures; coverage instructions 0.955, branches 0.831; 0 checkstyle violations; 0 SpotBugs bugs.
- Decisions: 020 (explicit facilitator list), 021 (public `RoutingSnapshot`, sync/publish split, snapshot-pinned overloads, parallel sync with budget), 022 (escrow phase fix), 023 (`System.Logger`), 024 (status vs transport errors, failover predicate), 025 (FacilitatorClient timeout defaults), 026 (`…Error` names), 027 (pin on `ResourceConfig`), 028 (unmapped settle fails), 029 (hook exception semantics), 030 (client surface).
- TS deviations (all documented): no settle loop for unmapped kinds (plan); connection errors are `FacilitatorResponseException` → 502 (TS 402); extensions cannot edit `accepts` in place (immutable records); no `ClientExtension` / v1 registration; the resource server rejects registration after the first `initialize()` (WP3 rule).
- 2026-10-12, review round (coordinator): red-first (manual, decision 001) for O4: `ReservedLocalFacilitatorTest` written first; `mvn -B -pl x402-core test-compile` → `cannot find symbol` (`InProcessFacilitatorClient`, `Builder.localFacilitator`).
- Review round, B3 (decision 001): `ExtensionEchoTest`, `MutationPolicyTest` and `ClientExtensionMergeTest` were added after implementation. At Base (`f8f83309` plus WP1/WP2) they cannot compile: `X402ResourceServer`, `ExtensionValidation`, `ResourceServerExtension`, `JsonValues` and `X402Client` do not exist there. So they are red at Base. There is no separate run of them before their code, because the code under test already existed when they were written.
- Review round, O4 fixed: `InProcessFacilitatorClient` marker, `X402ResourceServer.Builder.localFacilitator(...)`, and the reserved-`local` check in `build()` (decision 098). `FakeFacilitatorClient` now implements the marker (no assertion changed). New `X402ResourceServer.facilitatorCapabilityProblems` (structured, used by WP4's S2 fix).
- Review round, B2 scope review (decision 001 replaces check-scope.sh). `git status --short` cannot separate packages because nothing is committed, so the files changed since this package started (mtime ≥ 16:39) were listed. Under `java/x402-core` they are `src/main/java/org/x402/core/**` (30 files) and `src/test/java/org/x402/core/**` (22 files); both are inside this package's Allowed globs. WP3 docs: decisions 020–030, 098, the README lines, and this file. `java/x402-core/pom.xml` and `java/tools/ts-vectors/*` were not changed by WP3. Out of scope: other changed files under `java/tools/ts-vectors` and `docs/` belong to WP7, WP8 and WP9a, or to the orchestrator.
- Review round green: `cd java && mvn -B -pl x402-core verify -Pcoverage checkstyle:check spotbugs:check` → exit 0; 279 tests, 0 failures; coverage instructions 0.942, branches 0.817; 0 checkstyle violations; 0 SpotBugs bugs.
