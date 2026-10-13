# WP-11: a newcomer can protect an existing Spring endpoint from the README alone
Tier: R1
Base: <git rev-parse HEAD at package start>
Check: `examples/java/servers/spring-boot` starts with `mvn spring-boot:run` using only the annotation and application.yml, returns 402 unpaid and 200 when paid by `examples/java/clients/java-http` on preprod; docs checked against code

## Allowed files
- examples/java/**
- java/README.md
- java/CONTRIBUTING.md
- CONTRIBUTING.md
- docs/**  (includes docs/sdk-features.md)

## Rules
- Mirror the `examples/go` layout: `servers/`, `clients/`, `facilitator/`.
  - `servers/spring-boot` shows one single-option offer and one multi-option offer (USDM + lovelace + Masumi) built from named accounts (`preprod`, `preprod-escrow`), plus one offer accepting on `preprod` and `mainnet`, plus a runnable `multi-facilitator` Spring profile: two named facilitators (the second can be the WP12 example facilitator on another port), one pinned option and `failover: true`.
  - `clients/java-http` shows plain `X402HttpClient` and an `@HttpExchange` interface with spend controls.
  - `facilitator/` starts from YAML alone and answers `/supported`.
- `docs/sdk-features.md`: add a Java column that reflects only what is implemented (per `docs/AGENTS.md`).
- Root CONTRIBUTING.md: only add the Java row to the SDK table.
- java/README.md covers:
  - quick start (dependency, annotation, YAML)
  - the full `x402.*` property table, from config metadata
  - customizer beans
  - pricing: `"$0.50"` = 0.50 USDM on Cardano (1:1, no exchange rate; `"0.50 USDM"` is equivalent) vs `{amount, asset: lovelace}` for ADA; every route lists its options under `accepts`
  - streaming limitation
  - security filter ordering
  - thread hold up to the facilitator timeout
  - single-instance in-memory Masumi terms storage, and how to replace it
  - client spend controls: lovelace is refused by default; the `allowed-assets` entry for ADA is shown first
  - accounts for several networks, wallets and transfer methods (Roles §1a), the resolution order, and the TS-shaped inline alternative
  - multiple payment options and multiple facilitators (Roles §1, §1b): when a second facilitator is actually needed, the facilitator list and optional `identifier`, pinning, verify-only failover with settle following the verifier, the startup-sync cases, health details per facilitator and a readiness group example; the timeout budget (verify-timeout, settle timeout, 240 s client default)
  - facilitator server: Spring Security for `/settle`, the CSRF exemption for the base path, Blockfrost quota exposure
  - pointer to legacy v1
- No claims the code doesn't back; every snippet is compiled by an example module.

## Proof commands
- red-first: no new tests
- smoke: `ExampleProfilesSmokeTest` (it also parses every YAML snippet in the Java READMEs with SnakeYAML, and binds `examples/java/servers/spring-boot/src/main/resources/application-reference.yml`, which lists every `x402.*` key, through the real `X402Properties`; decision 005) in `examples/java/servers/spring-boot` starts the default and `multi-facilitator` profiles against WireMock facilitators and expects a 402
- green: `mvn -B -f examples/java/servers/spring-boot/pom.xml verify && mvn -B -f examples/java/clients/java-http/pom.xml verify && mvn -B -f examples/java/facilitator/pom.xml verify`
- scope: ~/.claude/bin/check-scope.sh docs/work/wp-11-examples-and-docs.md

## Log
- 2026-10-12 start (subagent). Base: f8f83309 (decision 001; no commits). SDK consumed as installed `2.0.0-SNAPSHOT` jars in `~/.m2` (autoconfigure reinstalled by a concurrent package at 20:08; all examples re-verified against it).
- red-first (manual, decision 001): `ExampleProfilesSmokeTest` + helpers (`FacilitatorStub`, `StrictX402Binding`) written before any example code, YAML or README.
  - `mvn -q -B -f examples/java/servers/spring-boot/pom.xml verify` → testCompile failure, only `cannot find symbol ExampleServerApplication`.
  - With a bare `@SpringBootApplication` class added (no YAML, controllers or READMEs): `Tests run: 5, Failures: 5` — README test "path … to exist" (no READMEs), reference test "application-reference.yml on the classpath … not null", default profile `expected: 200` (`/free` missing), mainnet `expected: 402`, multi-facilitator `expected: 1` (no `/supported` sync without offers). Tests frozen from here, except one helper fix below.
  - Post-red helper fix (no assertion changed): `metadataNames()` reads `additional-spring-configuration-metadata.json` as well, because the jar installed at 19:39 had a stale merged metadata file (decision 184). Mutation-checked: removing `cooldown-period` from the reference YAML then failed the test.
- Rules deviations, each with a decision: Spring client is its own module `clients/spring-rest-client` (180; the green command gains one module); the preprod + mainnet offer is in profile `mainnet` (181); the example facilitator is secured with Spring Security (182); wallets from the environment only (183). Root `CONTRIBUTING.md` and `java/CONTRIBUTING.md` were **not** edited: outside the files the orchestrator assigned (reported).
- Mutation checks of the smoke test (by hand, files restored byte-identical): unknown key `schem` in the reference YAML → `UnboundConfigurationPropertiesException`; removed `cooldown-period` → "keys missing from application-reference.yml"; README block with `pay-too` → unbound; README block with unquoted `${PAY_TO}` in a flow map → `ParserException`.
- Other example tests (`JavaHttpClientExampleTest` 3, `RestClientExampleTest` 4, `FacilitatorExampleTest` 4, `PayeeAllowlistTest` 1) were written with their code, not red-first (the WP lists no new tests besides the smoke test).
- green (all four, against the 20:08 jars):
  - `mvn -B -f examples/java/servers/spring-boot/pom.xml clean verify` → Tests run: 5, Failures: 0 — BUILD SUCCESS
  - `mvn -B -f examples/java/clients/java-http/pom.xml clean verify` → Tests run: 3, Failures: 0 — BUILD SUCCESS
  - `mvn -B -f examples/java/clients/spring-rest-client/pom.xml clean verify` → Tests run: 4, Failures: 0 — BUILD SUCCESS
  - `mvn -B -f examples/java/facilitator/pom.xml clean verify` → Tests run: 5, Failures: 0 — BUILD SUCCESS
- Check (live, preprod, 2026-10-12 ~20:10–20:16; credentials from `e2e/.env`, Masumi seller = public test mnemonic, decision 183):
  - `examples/java/facilitator` via `mvn spring-boot:run` on 8402; server via `mvn spring-boot:run` (annotation + `application.yml` only) on 8080.
  - `curl /free` → 200; `curl /weather` → 402 with `PAYMENT-REQUIRED`; `/report` decodes to 3 options (USDM 500000, lovelace 1500000, USDM 500000 masumi).
  - `java-http`, `PAY_WITH=ada`, `/report` → HTTP 200, `paid: success=true transaction=834f5d786dde0f9574806403ac7ce2189d1ec216943a47aa4fc3b3cd084a9a31`; server log "settled 1500000 lovelace"; facilitator log verify isValid=true, settle success=true.
  - `spring-rest-client`, `/weather` (USDM): first try right after the previous payment → settle rejected (`invalid_exact_cardano_payload_nonce_…`, stale Blockfrost UTxO), client got the 402, nothing paid (decision 187); later runs paid: tx `482516ed…`, then tx `5feb266a…` (first settle `settlement_pending`, retry success — pending retry exercised live).
  - Profile `multi-facilitator` with a second facilitator on 8403: `/actuator/health/x402` → both `UP`, readiness 200, `/report` 402. Primary stopped, `java-http` `PAY_WITH=ada` `/report` → HTTP 200, tx `ac719a97511da4410c619506dbff58151519c5bd5765e7b63a672d5984e0755d`; server log "verify on facilitator \"primary\" failed at transport level … failing over once to \"backup\"", "settle via facilitator \"backup\" … success=true".
  - Nothing ran on mainnet. All processes stopped; the scratch credential file deleted.
- Docs: `java/README.md` (new, v2), example READMEs, `docs/sdk-features.md` Java column (186), plan text corrections (185; a health-indicator correction was reverted after decision 160 landed), decisions 180–187.
- SDK issues found (not fixed, outside scope): `X402ClientBeanPostProcessor` warning and Javadoc still recommend the one-argument `decorate(factory)`; generated configuration metadata descriptions contain raw `{@code …}` markup; back-to-back payments from one wallet can reuse a spent input (187).
- 2026-10-12 independent review round (subagent; findings B1, S1, S2, O1–O4, B2, B3).
  - **B1** (decision 188). Red first: three new `FacilitatorExampleTest` cases. A missing `FACILITATOR_PASSWORD` already failed startup on Boot 3.5.16, but only by accident: `ReactiveUserDetailsServiceAutoConfiguration`'s condition resolves the placeholder strictly. The "starts with the literal `${FACILITATOR_PASSWORD}`" case did not reproduce. A **blank** password (`""`, `"   "`) did start: `aBlankOrPlaceholderPasswordIsRefused[1]`, `[2]` → "Expecting code to raise a throwable". A draft `${OTHER:x}` case was dropped as wrong (it resolves to `x`). Fix: `UserDetailsService` in `SecurityConfig` from `@Value("${FACILITATOR_PASSWORD}")`, refusing blank or `${`-containing values, BCrypt-encoded; `spring.security.user.*` removed from the YAML. Green: facilitator module 9 tests.
  - Decisions 182/183 corrected. Checked with the built jars: unset `PREPROD_PAY_TO` → "pay-to ${PREPROD_PAY_TO} is not a Cardano address on cardano:preprod: invalid bech32 address"; unset `SELLER_MNEMONIC` / `BUYER_MNEMONIC` → "Invalid mnemonic phrase". Placeholders stay literal and fail through address or mnemonic parsing, not placeholder resolution. A literal Blockfrost project id is caught only on the first chain call.
  - **S1** (decision 189). Red first: `PayeeAllowlistTest#settlingAPaymentToAnotherAddressIsAborted` → `expected: "payee_not_allowed" but was: "invalid_exact_cardano_payload"`. Fix: the same predicate on `onBeforeSettle`. Masumi shared-escrow note added to the class Javadoc and both READMEs.
  - **S2, O1–O4** (decision 200), docs only, each checked in code:
    - uncapped `allowed-assets` entries, `allow-any-asset` and `cardano:*` (`X402Client.resolveAtomicCap`);
    - redirect section scoped to the Spring clients, with `X402HttpClient` + `HostPolicy` behaviour (decision 012);
    - no Cardano method uses the escrow flow (`ExactCardanoServerScheme.paymentFlows` = `authorizationOnly`);
    - TLS for HTTP Basic;
    - claim store: 4096 entries, TTL + 120 s, refused settles when full (`DEFAULT_MAX_ENTRIES`, "settlement store is at capacity").
  - **B3** mutations, one per example test class, run with a scratch script that backs up, mutates, runs the class and restores (`filecmp` → `restored: True` each time):
    - `FacilitatorExampleTest`: CSRF exemption removed → `anAuthenticatedPostReachesTheFacilitatorWithoutACsrfToken` `expected: 400 but was: 401`.
    - `PayeeAllowlistTest`: `onBeforeSettle` removed → `settlingAPaymentToAnotherAddressIsAborted` `but was: "invalid_exact_cardano_payload"`.
    - `JavaHttpClientExampleTest`: `MAX_LOVELACE` 2000000 → 10000000 → `lovelaceAboveTheCapIsNeverSigned` FAILURE.
    - `RestClientExampleTest`: YAML lovelace cap 2000000 → 10000000 → `lovelaceAboveTheConfiguredCapIsNeverSigned` FAILURE.
    - `ExampleProfilesSmokeTest`: mutations logged above (unknown key, removed key, README unknown key, unquoted placeholder).
  - green (`mvn -B -f <pom> clean verify`): servers/spring-boot 5, clients/java-http 3, clients/spring-rest-client 4, facilitator 10. All BUILD SUCCESS.
  - **B2** scope review (`git status --short --untracked-files=all`, WP11 paths). Everything WP11 wrote is inside the allowed files:
    - `examples/java/**` (`.gitignore`, `README.md`, four modules: poms, sources, tests, resources, READMEs);
    - `java/README.md` (untracked new file; the index still holds the WP1 staged deletion `D  java/README.md`, so it needs `git add`);
    - ` M docs/sdk-features.md`;
    - `docs/decisions/180`–`189`, `200`, plus rows in `docs/decisions/README.md`;
    - `docs/plans/2026-10-12-java-v2-spring-starter.md` (text corrections);
    - `docs/work/wp-11-examples-and-docs.md`.

    ` M CONTRIBUTING.md` and `?? java/CONTRIBUTING.md` are in the status too: the **orchestrator** edited them, not this package's subagent. No file outside the WP's allowed list was touched.
