# Java v2 implementation decisions

One file per decision taken while implementing `docs/plans/2026-10-12-java-v2-spring-starter.md` without asking (user instruction, 2026-10-12: "If you have a question use your recommend path. Write a doc file for each decision you took.").

Each file: context, decision, alternatives, consequences, how to reverse.

| # | Decision |
|---|---|
| [001](001-checkpoint-commits.md) | No commits (git gate refused); staged changes, manual red-first |
| [002](002-keep-wp12-facilitator-server.md) | Keep WP12 (Spring facilitator server) |
| [003](003-dollar-price-notation.md) | Examples write prices as `"$0.50"` |
| [004](004-path-syntax-ts-only.md) | `path:` keeps the TS pattern syntax only |
| [005](005-reference-application-yml.md) | The plan carries one full reference `application.yml` |
| [006](006-claim-store-eviction-parity.md) | Settlement claim store mirrors TS eviction; guarantee stated precisely (superseded by 013 amendment / 126: retention until TTL + grace) |
| [007](007-starter-bundles-cardano.md) | The starter bundles the Cardano mechanism and extensions |
| [008](008-legacy-check-mirrors-ci.md) | Legacy check mirrors the existing CI commands |
| [009](009-ts-vectors-use-workspace-tsx.md) | `ts-vectors` runs with the TS workspace tsx, no install of its own |
| [010](010-spi-default-methods.md) | Optional TS scheme members are default methods, not capability interfaces |
| [011](011-money-bigdecimal.md) | Numeric money is BigDecimal, never double |
| [020](020-core-server-explicit-facilitators.md) | Core resource server needs an explicit facilitator list (default URL applied by the HTTP client / starter) |
| [021](021-routing-snapshot-api.md) | `RoutingSnapshot` is public; sync/publish split; request paths can pin one snapshot |
| [022](022-escrow-settles-after-handler.md) | `PaymentFlow.ESCROW` settles after the handler too (WP2 fix, TS parity) |
| [023](023-core-logging-system-logger.md) | Core logs through `System.Logger` |
| [024](024-facilitator-error-classification.md) | `FacilitatorStatusException` (402 path) vs `FacilitatorResponseException` (502); failover predicate |
| [025](025-facilitator-client-timeout-defaults.md) | `FacilitatorClient` default `verifyTimeout()`/`settleTimeout()` for the budget warning |
| [026](026-error-type-names.md) | `…Error` names kept from TS, as unchecked exceptions |
| [027](027-pin-on-resource-config.md) | Pin on core `ResourceConfig`; `PaymentOption` is an HTTP type |
| [028](028-unmapped-settle-fails.md) | Unmapped kind fails settle (no fallback); verify keeps the defensive loop |
| [029](029-hook-exception-semantics.md) | Hook exceptions: server warns, facilitator/client propagate (TS) |
| [030](030-client-surface.md) | Client: `X402ClientException`, `SpendControls` record, no client extensions yet |
| [031](031-http-validation-errors.md) | HTTP validation: every problem a classified `RouteValidationError` in `RouteConfigurationError`; pin/capability problems included |
| [032](032-route-unavailable-result.md) | `HttpProcessResult.RouteUnavailable`; protected routes need `initialize()` first |
| [033](033-fallback-paywall-text.md) | Static fallback paywall names `PaywallProvider` instead of `@x402/paywall` |
| [034](034-x402-http-client-behaviour.md) | `X402HttpClient` details: non-x402 402 passes through, check order, redirects, replay, recovery |
| [035](035-http-facilitator-client-transport.md) | `HttpFacilitatorClient` transport: whole-exchange timeouts, schema checks, `Retry-After` |
| [036](036-ambiguity-and-budget-checks.md) | Overlap check and timeout-budget warning details (fail closed) |
| [037](037-http-type-shapes.md) | Shapes of the HTTP-layer types WP5/WP6 build on |
| [038](038-paid-payload-to-scheme-enrichment.md) | Paid-path 402s hand the payload to scheme enrichment (closes 049's gap) |
| [039](039-http-client-lifecycle-delegation.md) | `X402HttpClient` delegates the JDK 21 lifecycle and is `AutoCloseable` |
| [040](040-eviction-outcome-b-corrected.md) | Post-eviction outcome (b) corrected: an evidence-capable backend reports success (superseded in part by 013: now a failure) |
| [041](041-sizes-from-wire-bytes.md) | Min-UTxO and Masumi datum sizes are measured on the wire bytes |
| [042](042-port-ts-not-lifted-pipeline.md) | Verification is a line-by-line TS port; the lifted facilitator supplies patterns only |
| [043](043-pure-java-apply-params.md) | Pure-Java Plutus parameter application; validator code as a Java constant |
| [044](044-in-module-jcs.md) | RFC 8785 JCS implemented in the module (ECMAScript number formatting) |
| [045](045-facilitator-signer-separate.md) | Facilitator addresses come from a separate optional signer |
| [046](046-backend-optional-capabilities.md) | Optional TS signer members are default methods with capability answers |
| [047](047-confirmation-wait-on-clock.md) | The confirmation wait cannot spin on a fixed Clock |
| [048](048-blockfrost-backend-http.md) | Blockfrost backend over java.net.http with TS reference semantics |
| [049](049-paid-payload-on-402.md) | How the quote issuer finds the paid payload on a 402 (core now fills it) |
| [050](050-deep-equal-canonical-json.md) | Requirements equality is canonical-JSON equality (TS deepEqual) |
| [051](051-cardano-exporter-uses-workspace-tsx.md) | The Cardano exporter runs with the workspace tsx |
| [052](052-fixture-set.md) | Fixture set: the 18 enumerated cases plus variants and settle cases |
| [053](053-array-advertisement-vector-dropped.md) | The array-shaped advertisement vector is not exported (unrepresentable in Java) |
| [054](054-test-setup-correction.md) | A test setup defect corrected after red-first |
| [055](055-own-cbor-reader.md) | Transactions are read with an in-module CBOR reader that keeps byte spans |
| [012](012-redirect-strips-credentials.md) | Cross-origin redirects followed by X402HttpClient drop credential and payment headers |
| [090](090-bazaar-typed-config-map-output.md) | Bazaar declarations are built from typed config objects and returned as ordered maps |
| [091](091-bazaar-mcp-declaration-included.md) | The MCP tool declaration is ported with the HTTP ones |
| [092](092-bazaar-extension-plain-resource-server-extension.md) | The bazaar server extension implements only `ResourceServerExtension` |
| [093](093-bazaar-vector-format.md) | Bazaar vectors: declare and enrich cases in one file, compared as exact JSON text |
| [094](094-bazaar-null-and-falsy-semantics.md) | JS defaults and truthiness are mapped to Java null and a truthiness helper |
| [095](095-paid-retry-to-checked-uri.md) | With a `HostPolicy`, the paid retry goes to the policy-checked URI that answered 402; empty bodies are replayable |
| [096](096-validation-wire-extra-and-retryable.md) | Route validation: wire-form `extra` for overlap, core capability check only for unused kinds, retryable classification |
| [097](097-escrow-timeout-budget.md) | Timeout budget counts 4 × settle for escrow; skip-handler on upfront warns |
| [098](098-reserved-local-identifier.md) | Core reserves `local` (`InProcessFacilitatorClient`, `Builder.localFacilitator`) |
| [099](099-facilitator-client-no-redirects.md) | `HttpFacilitatorClient` does not follow redirects by default (amends 035) |
| [013](013-cardano-replay-guard.md) | Cardano facilitator refuses replays of a landed payment (security divergence from TS) |
| [100](100-client-evolution-encoding-hand-rolled.md) | The Cardano client encodes transactions in Evolution's form with the module's CBOR writer, not cardano-client-lib |
| [101](101-client-collateral-ceiling-before-utxo-query.md) | The client's Masumi collateral ceiling is checked before the wallet's UTxOs are read |
| [102](102-client-wallet-provider-spi.md) | Client chain reads are a small `CardanoWalletProvider` SPI implemented by the Blockfrost backend |
| [103](103-client-funding-utxo-rules.md) | Client funding: reference-script UTxOs never spent; lovelace below min-UTxO refused |
| [104](104-client-signer-input-without-resource.md) | The client scheme passes no resource to the signer (TS parity) |
| [120](120-cbor-duplicate-keys-rejected.md) | Duplicate CBOR map keys in a transaction are a decode failure (security, fail closed) |
| [121](121-facilitator-entry-points-final.md) | The Cardano facilitator's public verify/settle are final; `verifyPayment` governs both |
| [122](122-masumi-terms-storage-fails-closed.md) | Masumi terms binding aborts when the terms storage fails (divergence from TS) |
| [123](123-null-evidence-is-unknown.md) | A backend's `null` transaction evidence is read as unknown |
| [124](124-claim-store-settled-state-abstract.md) | `SettlementClaimStore` gains abstract `markSettled` / `isClaimed` (implements 013; amended by 125/126) |
| [130](130-facilitator-unknown-fields.md) | Facilitator handler: unknown fields survive in the open maps; unknown top-level fields are accepted and ignored |
| [131](131-local-facilitator-client-mirrors-http.md) | `LocalFacilitatorClient` answers exactly what the HTTP path answers (errors → `FacilitatorStatusException` 500 with cause) |
| [132](132-facilitator-handler-request-rules.md) | Facilitator handler: 400/404/405 rules, path normalization, abort-network and error-text fallbacks |
| [133](133-facilitator-no-extension-responses.md) | The facilitator handler never writes the `extensionResponses` side channel |
| [134](134-facilitator-handler-logging.md) | The facilitator handler logs one line per verify and settle |
| [135](135-facilitator-vector-format.md) | Facilitator vectors record the TS client's outcome; TS itself proves the abort body |
| [136](136-facilitator-test-compile-fix.md) | A test compile defect corrected after red-first (WP12 core) |
| [060](060-starter-test-setup-corrections.md) | Three starter test setup defects corrected after red-first (env source name, no-offers app, `ContractApp` import) |
| [061](061-forbidden-keys-by-raw-presence.md) | Misplaced offer/defaults keys detected on the raw property sources |
| [062](062-static-price-checked-at-startup.md) | Static prices parsed by the registered scheme at startup (`"1.5 ADA"` fails startup) |
| [063](063-offer-selection-on-the-adapter.md) | The selected offer travels on the HTTP adapter; HEAD also tries GET path patterns |
| [064](064-path-route-warnings-by-sample-paths.md) | "Path matches no handler" / overlap warnings use sample paths |
| [065](065-servlet-buffering-details.md) | Servlet buffering and failure-path details (overrides kept in the wrapper, 502/500/503 bodies) |
| [066](066-sync-backoff-properties-and-phase.md) | `x402.sync.initial-backoff` / `max-backoff`; sync runs before the web server |
| [067](067-paywall-properties.md) | `x402.paywall.*` shape; `enabled=false` keeps 402s JSON |
| [068](068-client-config-details.md) | Payment client configuration details (prefer order, no-cap, shared beans) |
| [069](069-self-built-client-detection.md) | Self-built clients recognized by a marker initializer and a reflective factory read |
| [070](070-local-facilitator-selection.md) | Local facilitator = the single `InProcessFacilitatorClient` bean, via `Builder.localFacilitator` |
| [071](071-dynamic-price-method-guard.md) | The `price-ref` transfer-method guard is generic |
| [072](072-health-indicator.md) | `x402` health component states and details |
| [073](073-route-customizer-and-raw-extensions.md) | `X402RouteCustomizer` seam; extension declarations pass through |
| [074](074-metadata-wildcards.md) | Additional metadata uses `*` / `[]` names for map values and list elements |
| [075](075-paid-request-never-redirected.md) | A paid request is never redirected: separate non-redirecting paid factory; 1-arg `decorate` warns |
| [125](125-public-verify-by-claim-state.md) | Public verify decides by claim state: a submitted claim resumes, a store failure fails closed |
| [126](126-claim-retention-until-ttl.md) | Submitted and settled claims are retained until TTL + 120 s grace (divergence from TS eviction) |
| [127](127-evidence-null-status-unknown.md) | Transaction evidence with a `null` status is unknown |
| [076](076-webflux-test-fixture-corrections.md) | WebFlux test fixture corrected after red-first (Netty pinned, dual-stack, own loops, user store); leak tracking via an outer buffer factory |
| [077](077-webflux-filter-details.md) | WebFlux filter details: isolated handler lookup, boundedElastic offload, copy-and-release buffering |
| [078](078-webclient-paid-request-redirects.md) | WebClient paid request never follows redirects (twin connector via Reactor context; following Reactor connectors refused) |
| [079](079-webclient-body-recording.md) | WebClient body recording and replay details |
| [140](140-cardano-receiver-guard-in-scheme-subclass.md) | Per-request Cardano receiver check lives in a server-scheme subclass (`GuardedCardanoServerScheme`) |
| [141](141-cardano-extra-reshaped-from-yaml.md) | Cardano `extra` from YAML reshaped to JSON form (integer policy, deployment lists) |
| [142](142-cardano-network-beans-and-plan.md) | Network-aware beans, Masumi settings union, pre-scanned escrow set, client entry rules |
| [143](143-fail-closed-paid-transports.md) | Fail closed on unverifiable paid transports: known-following refused, unknown returns the 402 unpaid; static `wrap` stays caller-asserted |
| [144](144-paid-response-fully-buffered.md) | The paid handler's whole response (status, headers, cookies) is buffered; supersedes 065's pass-through headers |
| [145](145-webclient-replay-body-headers.md) | WebClient paid retry restores the body writer's Content-Type/Encoding |
| [146](146-dispatch-guard.md) | Dispatch guard (MVC interceptor, WebFlux adapter) fails closed for unprocessed paid handlers |
| [147](147-webflux-core-calls-immune-to-cancel.md) | WebFlux core calls survive a cancelled subscription once started |
| [148](148-static-price-final-extra.md) | Static-price options carry the final merged `extra` |
| [149](149-client-resource-url-required-and-leaks.md) | 402 without resource.url is not paid; paid responses always released |
| [150](150-review-optional-fixes.md) | Path offers over streaming handlers fail; re-sync never dies; empty cap warns |
| [170](170-java-e2e-client-exit-codes.md) | Java e2e client exits 1 with a JSON error when the request cannot complete (exit 0 + error would be a harness false green) |
| [171](171-java-e2e-client-packaging.md) | Java e2e client is a standalone Maven app (x402-parent BOM, `target/lib` classpath); `build.sh` installs the reactor |
| [172](172-setup-sh-java-defaults.md) | `setup.sh`: `pom.xml` counts as setup work, default `mvn -q package` |
| [173](173-java-client-awaits-wallet-settle.md) | Java e2e client waits for the change output like the TS client |
| [174](174-wp10-live-check-without-seller-mnemonic.md) | WP10 phase 1 live check: default/script via a scratch no-Masumi server; harness Check blocked on `SERVER_CARDANO_SELLER_MNEMONIC` |
| [175](175-e2e-run-environment-prep.md) | Local e2e prep: TS SDK dists rebuilt via turbo; `e2e/pnpm-lock.yaml` auto-install rewrite restored |
| [176](176-e2e-ci-setup-java.md) | `e2e_tests.yml` setup-java (pinned v4.8.0, gated like Go/uv); CI never selects Cardano without the seller secret |
| [151](151-bazaar-yaml-and-route-patterns.md) | Bazaar declarations from YAML; Spring patterns handed to hooks in x402 syntax |
| [152](152-facilitator-server-spring-wiring.md) | Spring facilitator server wiring: three routed paths, customizer-first registration, shared claim store, optional Clock |
| [014](014-test-servers-on-127-0-0-1.md) | Spring tests address their own server as 127.0.0.1 (IPv6 port-collision flake) |
| [015](015-resource-url-missing-fails-closed.md) | X402HttpClient with a host policy refuses a 402 without resource.url |
| [153](153-default-schemes-after-customizers.md) | Default Cardano schemes register after customizers, only where none answers |
| [154](154-webflux-facilitator-cancel-immune.md) | WebFlux facilitator endpoints run the handler cancel-immune |
| [155](155-escrow-by-script-hash.md) | Escrow receivers are detected by script hash; price.extra deployments pre-scanned |
| [156](156-confirmation-policy-precedence.md) | Confirmation policy precedence; OptionDraft exposes declared extra and timeout |
| [157](157-cardano-config-hardening.md) | Non-object deployment, several plain beans, CIP-34 aliases |
| [158](158-masumi-template-checked-at-startup.md) | Masumi template rules checked at startup |
| [159](159-retry-response-closed.md) | Recovered retry response closed when the hook throws |
| [160](160-facilitator-health-indicator.md) | `x402-facilitator` health component |
| [016](016-client-has-registered-scheme.md) | Core X402Client.hasRegisteredScheme replaces the starter's message-matching probe |
| [180](180-client-examples-split.md) | Two client examples: plain `clients/java-http` and Spring `clients/spring-rest-client` (`@HttpExchange`, self-built `RestClient`) |
| [181](181-mainnet-offer-in-a-profile.md) | The preprod + mainnet offer lives in the server example's `mainnet` profile, so the walkthrough needs only a preprod facilitator |
| [182](182-example-facilitator-secured.md) | The example facilitator is protected with Spring Security (HTTP Basic on verify/settle, CSRF exempt); the server sends `FACILITATOR_AUTHORIZATION` |
| [183](183-example-wallets-from-the-environment.md) | Example wallets come from the environment, no default addresses or mnemonics; the live check used the public test mnemonic as Masumi seller |
| [184](184-example-smoke-test-mechanics.md) | `ExampleProfilesSmokeTest`: strict binding per owning properties class, metadata completeness, README YAML bound, three profiles against WireMock |
| [185](185-plan-text-corrections-wp11.md) | Plan text aligned with the code: YAML quoting, two-argument `decorate`, `HookResults.Decision`, change map |
| [186](186-sdk-features-java-column.md) | The Java column of `docs/sdk-features.md` (paywall: static fallback only) |
| [187](187-back-to-back-payments-documented.md) | Back-to-back payments from one wallet can reuse a spent input; documented, not worked around |
| [188](188-facilitator-password-fails-closed.md) | The example facilitator builds its user from `@Value("${FACILITATOR_PASSWORD}")` and refuses a missing, blank or placeholder password |
| [189](189-payee-allowlist-on-settle.md) | The example payee allowlist guards `/settle` as well as `/verify`; the shared Masumi escrow address admits all Masumi sellers |
| [200](200-wp11-review-doc-corrections.md) | WP11 review doc fixes: uncapped allowed assets, redirect scope, no Cardano escrow flow, TLS for Basic auth, claim store capacity |
| [177](177-java-e2e-servers-properties-from-catalog.md) | Java e2e servers build `x402.*` from the catalog as default properties (per-method accounts, catalog `extra` on the accepts entry, bazaar from the catalog) |
| [178](178-java-e2e-route-handlers-and-annotated-route.md) | Java e2e servers: catalog handlers registered on Spring's mapping; `/exact/cardano/default` served by `@X402Payment` |
| [179](179-java-e2e-masumi-without-seller.md) | Masumi route left out without a seller mnemonic; Masumi offer checked by 402 shape only (throwaway key, no payment) |
| [190](190-java-e2e-facilitator.md) | Java e2e facilitator: base path `/`, TS env mapping, `extensions: []` keeps bazaar validation off it |
| [191](191-wp10-phase2-live-check.md) | WP10 phase 2 live check by direct runs; failures traced to concurrent use of the shared client wallet |
| [192](192-java-e2e-spring-apps-build.md) | Java e2e Spring apps: Boot parent 3.5.16, `target/app.jar`, reactor install in `build.sh` |
| [193](193-java-e2e-no-false-green.md) | Java e2e servers exit 1 unless x402 is READY; java-http succeeds only on 2xx and exits 1 on other non-402 statuses |
| [194](194-java-e2e-review-small-fixes.md) | WP10 review fixes: `clean package` client build, JDK/Maven prerequisite, typed catalog `extra` (arrays as lists) |
