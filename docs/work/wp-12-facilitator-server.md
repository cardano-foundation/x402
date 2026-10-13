# WP-12: developers run an x402 facilitator from YAML; the wire contract matches the plan's normative table
Tier: R2
Base: <git rev-parse HEAD at package start>
Check: `FacilitatorExtensionPointsTest`, `FacilitatorWireContractTest`, `LocalFacilitatorClientTest`, `X402FacilitatorServerMvcTest`, `X402FacilitatorServerWebFluxTest` pass

## Allowed files
- java/x402-core/src/main/java/org/x402/http/facilitator/**
- java/x402-core/src/test/java/org/x402/http/facilitator/**
- java/x402-core/src/test/resources/vectors/facilitator/**
- java/tools/ts-vectors/export-facilitator.ts
- java/x402-spring-boot-autoconfigure/src/main/java/org/x402/spring/facilitator/**
- java/x402-spring-boot-autoconfigure/src/test/java/org/x402/spring/facilitator/**
- java/x402-spring-boot-autoconfigure/src/main/resources/META-INF/spring/**
- docs/**

## Rules
- Starts after WP13. This package is **beyond parity** (plan decision 3): no other SDK ships a facilitator server. Keep the surface small: one handler, two thin adapters, one in-process client.
- **`FacilitatorHttpHandler`** (`org.x402.http.facilitator`, framework-free): `handle(method, path, bodyBytes) → {status, jsonBody}` around an `X402Facilitator`. It implements the plan's normative wire table (Roles §3):
  - POST verify/settle body `{x402Version, paymentPayload, paymentRequirements}`; a missing field → 400
  - verify invalid → 200 `isValid:false`
  - `SettleAbortedException` → 200 `{success:false, errorReason:<reason>, transaction:"", network:<paymentRequirements.network>}`
  - other exceptions → 500 `{error}`
  - GET supported → `getSupported()`
  - unknown JSON fields inside the open maps (`payload`, `extensions`, `extra`) survive at any depth; unknown top-level fields of `paymentPayload` / `paymentRequirements` / `resource` are accepted and dropped, because the v2 types are closed field sets in every SDK (decision 130); no raw-byte passthrough
  - no `EXTENSION-RESPONSES` header
- **Vectors:** run **only** `export-facilitator.ts`, never the other exporters, so the WP2/WP4/WP7 vectors are untouched.
  - It starts a local capture server and drives the TS `HTTPFacilitatorClient` against it, recording the exact request bodies for verify and settle.
  - Response expectations come from the plan's normative table; their source is cited as `e2e/facilitators/typescript/index.ts:1039-1131`.
  - `FacilitatorWireContractTest` checks that the handler accepts the captured requests, that every response matches the table, and that the abort body passes a Java port of TS `settleResponseSchema` (`httpFacilitatorClient.ts:179-180`). The WP4 Java `HttpFacilitatorClient` must round-trip against the handler.
- **`LocalFacilitatorClient`** implements `FacilitatorClient` by calling an in-process `X402Facilitator`, mapping `SettleAbortedException` to the same `SettleResponse` as the handler. `LocalFacilitatorClientTest` asserts HTTP and local results are identical for valid, invalid, abort and error.
- **Spring facilitator server** (`org.x402.spring.facilitator`):
  - `X402FacilitatorServerAutoConfiguration`, active when `x402.facilitator-server.enabled=true`; independent of `x402.enabled`
  - declared `@AutoConfiguration(before = X402AutoConfiguration.class)`; when `x402.local-facilitator=true`, it contributes a `LocalFacilitatorClient` bean, which WP5's auto-config uses automatically
  - when `expose-http=true` (default): MVC registers a `RouterFunction<ServerResponse>`; WebFlux registers a reactive `RouterFunction` with handler calls offloaded to `boundedElastic`
  - `base-path` defaults to `/x402`; `""` and `/` normalize to root
  - properties `x402.facilitator-server.cardano.{accept-mempool, confirmation-timeout (75s), confirmation-poll (5s), networks: [{network, blockfrost.{project-id, base-url}, mnemonic?}]}` → one facilitator signer + `ExactCardanoFacilitatorScheme` (WP7) per network entry; provider-only when an entry has no mnemonic. No `l1-confirmations` key: the server picks the policy, the facilitator advertises its range
  - override points per plan §3a, all `@ConditionalOnMissingBean`: `X402Facilitator`, `SettlementClaimStore` (WP7's bounded in-memory default), `PendingSettlementStore` (core in-memory default), `MasumiRegistryValidator`, `MasumiDeploymentValidator`, `Clock`, `FacilitatorExtension` beans (registered in bean order), `FacilitatorHttpHandler` (a bean, also usable from own controllers when `expose-http=false`)
  - `CardanoFacilitatorSchemes` bean: `forNetwork(network)` returns the auto-built scheme per configured network
  - registration order: `X402FacilitatorCustomizer` beans run first; auto-configuration then registers the Cardano scheme only for (scheme, network) pairs no customizer claimed, so a custom scheme wins under first-registered routing
  - `confirmation-timeout` above 85 s logs a warning (resource servers' facilitator timeout is 90 s)
  - `CardanoChainBackend` overrides go through the by-network provider (a single plain bean only with one network)
  - no built-in auth (README: Spring Security, plus a CSRF exemption for the base path)
- `X402FacilitatorServerMvcTest` / `X402FacilitatorServerWebFluxTest` (fake scheme): endpoints answer the table; root and `/x402` base paths; `expose-http=false` exposes no endpoints but still provides the local client; provider-only startup; `/supported` advertises `l1Confirmations` `{minimum:0, maximum:20}`, and `{minimum:-1, …}` with `accept-mempool`; two network entries give two kinds with their own backends; customizer hooks fire; `FacilitatorExtensionPointsTest` covers every §3a override; BlockHound clean on WebFlux; facilitator-only app (no offers) skips resource-server sync.

## Proof commands
- red-first: ~/.claude/bin/red-first.sh <Base> --setup 'mvn -q -f java/pom.xml install -DskipTests' java/x402-core/src/test/java/org/x402/http/facilitator/FacilitatorWireContractTest.java java/x402-core/src/test/java/org/x402/http/facilitator/LocalFacilitatorClientTest.java java/x402-spring-boot-autoconfigure/src/test/java/org/x402/spring/facilitator/FacilitatorExtensionPointsTest.java java/x402-spring-boot-autoconfigure/src/test/java/org/x402/spring/facilitator/X402FacilitatorServerMvcTest.java java/x402-spring-boot-autoconfigure/src/test/java/org/x402/spring/facilitator/X402FacilitatorServerWebFluxTest.java -- mvn -f java/pom.xml -pl x402-core,x402-spring-boot-autoconfigure test
- green: `mvn -B -f java/pom.xml verify -Pcoverage checkstyle:check spotbugs:check`
- scope: ~/.claude/bin/check-scope.sh docs/work/wp-12-facilitator-server.md

## Log
- 2026-10-12 core step (handler, local client, vectors; Spring part later): exporter `export-facilitator.ts` run alone → `vectors/facilitator/http-facilitator-client.json` (11 cases, TS commit f8f83309).
- red-first (manual, decision 001): `mvn -pl x402-core test -Dtest=FacilitatorWireContractTest,LocalFacilitatorClientTest` → test compilation fails, missing only `FacilitatorHttpHandler`, `FacilitatorHttpResponse`, `LocalFacilitatorClient`; tests frozen from here.
- post-red test fix (decision 136): three `assertThat(same(...))` lines in `LocalFacilitatorClientTest` were ambiguous to javac once the classes existed; explicit type witnesses added, no assertion changed.
- green (core step): `cd java && mvn -B -pl x402-core verify -Pcoverage checkstyle:check spotbugs:check` → exit 0; 331 tests (41 `FacilitatorWireContractTest`, 11 `LocalFacilitatorClientTest`), coverage checks met (module instr 0.949, branch 0.826), 0 Checkstyle violations, 0 SpotBugs.
- decisions 130–136. Open for the Spring step: `FacilitatorExtensionPointsTest`, `X402FacilitatorServerMvcTest`, `X402FacilitatorServerWebFluxTest`.
- 2026-10-12 Spring step start (subagent, after WP13/WP9b). Base: f8f83309 (decision 001).
- red-first (manual, decision 001): `FacilitatorExtensionPointsTest` (8), `X402FacilitatorServerMvcTest` (7), `X402FacilitatorServerWebFluxTest` (2) written before any Spring facilitator code → `mvn -B -pl x402-spring-boot-autoconfigure test -Dtest=FacilitatorExtensionPointsTest,X402FacilitatorServerMvcTest,X402FacilitatorServerWebFluxTest` → BUILD FAILURE, compilation errors (`cannot find symbol X402FacilitatorCustomizer`, `CardanoFacilitatorSchemes`, `X402FacilitatorServerAutoConfiguration`).
- green (Spring step): `cd java && mvn -B -pl x402-spring-boot-autoconfigure verify -Pcoverage checkstyle:check spotbugs:check` -> exit 0, BUILD SUCCESS; Tests run 264, Failures 0, Errors 0 (WP12 Spring Check: FacilitatorExtensionPointsTest 8, X402FacilitatorServerMvcTest 7, X402FacilitatorServerWebFluxTest 2 under BlockHound; all green on the first implementation run); jacoco instructions 0.940, branches 0.838; checkstyle 0; spotbugs 0. Decision 152. Additional IDE metadata for `x402.facilitator-server.cardano.networks[]` and `x402.accounts.*.cardano.*` added.
- red-first (manual, decision 001): review round 2, see the WP13 Log entry of the same run (facilitator findings 1, 2, 12).
- Scope note (review round 2): `src/main/resources/META-INF/additional-spring-configuration-metadata.json` (outside `META-INF/spring/**`) was edited for IDE metadata. Allowed files amendment: java/x402-spring-boot-autoconfigure/src/main/resources/META-INF/additional-spring-configuration-metadata.json.
- green (review round 2): `cd java && mvn -B -pl x402-spring-boot-autoconfigure verify -Pcoverage checkstyle:check spotbugs:check` -> exit 0, BUILD SUCCESS; Tests run 277, Failures 0, Errors 0; jacoco instructions 0.942, branches 0.840; checkstyle 0; spotbugs 0. Decisions 153-160. Cross-package edits of this round: `X402AutoConfiguration` (defaults SPIs), `OptionDraft`/`OfferResolver` (declared extra, timeout), `X402WebFilter` (`offload` public), `X402ClientHttpRequestFactory` (retry close), new root types `X402SchemeDefaults`, `X402ClientSchemeDefaults`, `ClientSchemes`.
- scope review (`git status --short -uall -- java/x402-spring-boot-autoconfigure java/x402-spring-boot-starter`, 2026-10-12): every change of this agent is under java/x402-spring-boot-autoconfigure (pom, src/main, src/test, resources); the starter module entries are WP1's staged skeleton; docs only under docs/work and docs/decisions.
