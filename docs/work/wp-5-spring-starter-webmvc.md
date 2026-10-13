# WP-5: @X402Payment + application.yml protects WebMvc endpoints per the plan's rules 1–9
Tier: R2
Base: <git rev-parse HEAD at package start>
Check: `OfferResolutionTest`, `X402PaymentMvcTest` (extends `X402StarterContract`, MVC-only cases inside), `X402PropertiesBindingTest`, `OfferRegistryTest`, `MultiOptionOfferTest`, `StartupSyncTest`, `X402ClientStarterTest` pass

## Allowed files
- java/x402-spring-boot-autoconfigure/pom.xml
- java/x402-spring-boot-autoconfigure/src/main/java/org/x402/spring/*.java
- java/x402-spring-boot-autoconfigure/src/main/java/org/x402/spring/annotation/**
- java/x402-spring-boot-autoconfigure/src/main/java/org/x402/spring/properties/**
- java/x402-spring-boot-autoconfigure/src/main/java/org/x402/spring/offer/**
- java/x402-spring-boot-autoconfigure/src/main/java/org/x402/spring/actuate/**
- java/x402-spring-boot-autoconfigure/src/main/java/org/x402/spring/web/servlet/**
- java/x402-spring-boot-autoconfigure/src/main/java/org/x402/spring/client/servlet/**
- java/x402-spring-boot-autoconfigure/src/main/java/org/x402/spring/autoconfigure/X402AutoConfiguration.java
- java/x402-spring-boot-autoconfigure/src/main/java/org/x402/spring/autoconfigure/X402WebMvcAutoConfiguration.java
- java/x402-spring-boot-autoconfigure/src/main/resources/**
- java/x402-spring-boot-autoconfigure/src/test/java/org/x402/spring/*.java
- java/x402-spring-boot-autoconfigure/src/test/java/org/x402/spring/offer/**
- java/x402-spring-boot-autoconfigure/src/test/java/org/x402/spring/autoconfigure/**
- java/x402-spring-boot-autoconfigure/src/test/java/org/x402/spring/web/servlet/**
- java/x402-spring-boot-autoconfigure/src/test/java/org/x402/spring/client/**
- java/x402-spring-boot-autoconfigure/src/test/resources/**
- java/x402-spring-boot-starter/**
- docs/**

## Rules
- `@X402Payment(String value)`: `@Target({METHOD, TYPE})`, `@Retention(RUNTIME)`, `@Documented`.
- **`X402Properties`** (`@ConfigurationProperties("x402")`, records + `@DefaultValue`) binds the plan's "Developer-facing contract":
  - `price` is a `PriceSpec`: a money string (TS `parseMoney` syntax) via a `@ConfigurationPropertiesBinding` converter, or `{amount, asset, extra}` bound as an object (TS `AssetAmount`); `price` + `price-ref` → startup error; `extra` is `Map<String,Object>`; per-accept `account`, `scheme`, `network`, `pay-to`, `max-timeout-seconds`
  - `accounts: Map<String, {network, pay-to, pay-to-ref, scheme, max-timeout-seconds, extra, facilitator}>`, bound to a `LinkedHashMap`; names `[a-z0-9-]+`. The per-account mechanism block (`cardano.*`) is bound by WP13's own properties class over the same prefix (unknown fields ignored here).
  - per offer: `accepts` (always a list; offer-level `price`, `price-ref` or `accounts` → startup error); offer `failover` is a nullable `Boolean` (absent inherits `defaults.failover`; explicit `false` overrides `true`), and `X402PropertiesBindingTest` covers both; `defaults` = `{scheme, max-timeout-seconds, failover, facilitator}`
  - **`OfferResolver`** (plan Roles §1a rules 1–5, 8; receiver and price resolve as one choice per group; `extra` near-miss keys from env-var lowercasing → error) turns offers + accounts + defaults into core `RouteConfig`s before core sees them; `OfferResolutionTest` covers the acceptance list
  - **`X402OptionContributor`** SPI (`org.x402.spring.offer`): every contributor bean is called once per resolved option with (account name or none, network, merged `extra`, draft option), after merging and before core validation; it may set `pay-to` and add `extra` keys, never change `network` or an inherited `assetTransferMethod`; afterwards an option without `pay-to`/`pay-to-ref` fails startup; an option changing its account's `assetTransferMethod` fails startup
  - `additional-spring-configuration-metadata.json` documents the fields under `accounts.*`, `facilitators[]` and `routes.*` (offer fields and `accepts[]` entries) (the processor emits none for `Map` values); neither properties class sets `ignoreUnknownFields=false`, because WP13 binds `accounts.*.cardano` over the same prefix
  - per-accept `price-ref` / `pay-to-ref` (bean names of `X402DynamicPrice` / `X402DynamicPayTo`, resolved per request)
  - `facilitators: List<{url, identifier?, headers.{verify, settle, supported}, timeout (default 90 s), verify-timeout (default 15 s), auth-ref}>` (TS/Go/Python list shape; list order = precedence). effective identifier = `identifier`, else `url`, with trailing slashes removed in both cases (TS/Python url normalization); pins match only effective identifiers, normalized the same way; duplicate effective identifiers after normalization or a user `local` → startup error. Nullable; empty or absent → one entry `https://x402.org/facilitator`. No single-entry `facilitator:` key.
  - `auth-ref` names an `X402FacilitatorAuthProvider` bean for that facilitator.
  - `facilitator` (name) is allowed per option, per account and in `defaults` (option > account > defaults); offer-level `facilitator` is an error. `failover` (boolean) is allowed per offer and in `defaults`.
  - `sync.startup-timeout` (default 10 s, total budget); `local-facilitator` (boolean); `paywall.*`; `filter-order`
  - `client.*`:
    - `enabled`
    - `spend-controls.{enabled (default true), max-amount-per-payment (default "$1"), allow-any-asset (default false), allowed-assets: [{network, asset, max-amount-per-payment}]}` → core spend controls
    - `prefer.{networks, schemes}` → built-in policies; the first entry wins
    - `client.cardano.*` is bound here; WP13 consumes it
  - config metadata via spring-boot-configuration-processor
  - `X402PropertiesBindingTest` covers:
    - price as `"$0.50"`, `"0.50 USDM"`, `{amount, asset, extra}`; `price.extra` merged below account/option; `x402.defaults.extra` → startup error (the starter checks for it explicitly, since unknown fields are otherwise ignored); a placeholder `price: "${REPORT_PRICE:$0.50}"` overridden by env works; an env var on `accepts[0].price` alone replaces the YAML list and fails startup with a message pointing to placeholders; `price` + `price-ref` error; `"1.5 ADA"` error; `extra` map; defaults merge
    - minimal config (one account + one offer with a one-entry `accepts`)
    - `facilitators` absent → default entry; order kept; identifier defaults to the url without trailing slash; duplicates (incl. `https://a` vs `https://a/`, and an explicit identifier equal to another entry's url) → error; unknown pin → startup error; pin by url works only without an explicit identifier; `identifier: team/` is pinned by `team` and by `team/`
    - `facilitators` with `sync.startup-timeout` and `local-facilitator`
    - pin precedence (option > account > defaults); failover (offer > defaults)
    - spend-control shapes
- **`OfferRegistry`** (stack-neutral, `org.x402.spring.offer`): `Map<Method, Offer>`, built from a small `HandlerMethodSource` interface that supplies the handler methods **and** a stack-specific `isStreaming(HandlerMethod)` predicate. WP5 supplies the servlet source; WP6 the reactive one.
  - unknown offer → startup failure listing the known offers
  - class-level vs method-level resolution
  - offer without `path` or annotation → warning
  - `{`/`}` in `path:` → startup failure
  - `path:` matching no registered handler → warning
  - a paid authorization-flow handler for which the source's `isStreaming` returns true → startup failure. The servlet source flags `SseEmitter`, `ResponseBodyEmitter`, `StreamingResponseBody`, `ResponseEntity<StreamingResponseBody>` and `text/event-stream` produces.
- **Resolution in `X402ServletFilter`:**
  1. skip CORS pre-flight (`CorsUtils.isPreFlightRequest`)
  2. resolve the winning handler with Spring's own handler mappings, as Spring Security does via `HandlerMappingIntrospector`, isolating request-attribute side effects
  3. if it is a `HandlerMethod` with an offer → that offer
  4. else `PatternRouteResolver` over `path:` offers, with `path` = the raw path within the application (`UrlPathHelper` with `urlDecode=false`, `;` params stripped) and `decodedPath` separately
  5. annotation wins on overlap (logged once at startup)
  6. HEAD on a paid GET handler is charged
- **`X402ServletFilter`** (`OncePerRequestFilter`):
  - buffers the response (own implementation; no dependency on legacy)
  - follows the WP4 adapter contract: cancel on ≥ 400 or exception, settle with pending retry on < 400, 402 on settle failure, 502 on facilitator error, before-handler settlement for upfront/escrow
  - async: `shouldNotFilterAsyncDispatch() == false`; state in a request attribute; settle exactly once on the final dispatch; never double-wrap on ASYNC re-entry
- Filter order default `SecurityProperties.DEFAULT_FILTER_ORDER + 1`; `x402.filter-order` overrides.
- **Auto-configuration:**
  - `X402AutoConfiguration`: core beans and customizers, all `@ConditionalOnMissingBean`.
    - It builds one `HttpFacilitatorClient` per list entry. A `LocalFacilitatorClient` bean (WP12) is prepended with identifier `local`.
    - `local-facilitator=true` with no `FacilitatorClient` bean → startup failure telling the user to enable `x402.facilitator-server` (WP12 supplies the bean from an auto-config ordered before this one).
  - **Startup sync** (`SmartLifecycle`) implements the four cases in plan Roles §1b on top of WP4's `initialize()` / `RouteConfigurationError` / `isFatalStartupError`:
    - total budget `sync.startup-timeout`; facilitators queried in parallel, results applied in declaration order
    - all answered + validation error → startup fails
    - partial failure + only facilitator-kind / pin errors → start
      - **affected routes only** return 503 immediately with `Retry-After` and never block on a sync; other routes serve
      - a single-flight background re-sync (one scheduled task, exponential backoff, max interval 60 s) calls core `initialize()`; at most one is in flight
    - non-kind validation errors (missing scheme, unsupported method/flow) → always fatal
    - a facilitator failed at startup but the others covered every kind → app UP, no re-sync (TS parity: ownership is fixed until restart); logged once as a warning
    - background re-sync + validation error → affected routes return 500, unaffected routes keep working, logged once; re-sync continues with backoff (not terminal)
    - no offers → sync skipped
    - `X402HealthIndicator` reports UP / OUT_OF_SERVICE / DOWN accordingly
    - `StartupSyncTest` has one test per case, plus one for the health states, plus a concurrency test: during an outage, 50 concurrent protected requests all get 503 within 100 ms, and the WireMock facilitators see exactly one in-flight `/supported` call each
  - `X402WebMvcAutoConfiguration`: `@ConditionalOnWebApplication(type = SERVLET)`.
  - Cardano wiring (server scheme, seller signer, Masumi storage and escrow check, Cardano client scheme) is **not** in this package; it belongs to WP13.
  - `x402.enabled=false` disables the resource server and the client. It does not affect `x402.facilitator-server` (WP12). No `Optional<T>` bean types.
- **Payment options** (plan "Roles §1"):
  - `accepts` order is preserved into `PAYMENT-REQUIRED.accepts`
  - validation comes from WP4's core `RouteConfigurationError` (TS parity); the starter adds the offer name and option index to the message
  - `MultiOptionOfferTest` (fake schemes):
    - a 4-option offer → 4 accepts in order
    - a payment for option 3 matches option 3, including additive client `extra`
    - an unsupported option → startup failure
    - two facilitators where the first owns a kind; a pinned option uses its facilitator; an offer with `failover: true` verifies on the backup when the owner returns 503 without an `isValid` body, then settles there
  - The `x402` health indicator lists each facilitator's state in its **details**. A facilitator no route needs never makes the aggregate DOWN. A test asserts that `/actuator/health` stays UP when an unneeded facilitator is down.
- **Client** (when `x402.client.enabled`):
  - the payment step is a **`ClientHttpRequestFactory` decorator** (`X402ClientHttpRequestFactory`), below every interceptor.
    - It is applied to Boot-built `RestClient` / `RestTemplate` by a `BeanPostProcessor` on Boot's `ClientHttpRequestFactoryBuilder` bean. The post-processor returns a delegating builder: `settings -> new X402ClientHttpRequestFactory(delegate.build(settings), …)`, so Boot's and the user's HTTP settings are kept.
    - The paid retry re-sends the request as prepared by the interceptors, plus `PAYMENT-SIGNATURE`. Interceptors don't re-run, and header-signing interceptors are unsupported (plan Roles §2).
    - It closes the first 402 response before the retry.
    - Tests: a static-auth interceptor's header is present on the paid retry; a header-signing interceptor's signature does not cover `PAYMENT-SIGNATURE` (documented limitation); a custom factory setting (e.g. a timeout) survives instrumentation.
  - `@HttpExchange` proxies built from them pay too.
  - `X402ClientBeanPostProcessor` (when `x402.client.instrument-beans`, default true): a self-built `RestClient` or `RestTemplate` bean is **not** modified. Its factory cannot be read and wrapped safely, so the post-processor logs a warning naming the bean and the fix `x402Decorator.decorate(factory)` (an injected `X402ClientHttpRequestFactoryDecorator` bean carrying the configured client and `x402.client.hosts`; the plain `X402ClientHttpRequestFactory.wrap(factory, x402Client, hostPolicy)` needs the policy explicitly) at construction time. Boot-built clients carry a marker and are skipped silently.
  - **Host allowlist** `x402.client.hosts` (exact or `*.domain` matching subdomains only; case-insensitive; port ignored; checked on the URI the client sent, plus the host of `PAYMENT-REQUIRED.resource.url`; redirect-following transports trust the allowed host's redirect, as documented; `spring.http.client.redirects=dont-follow` is the strict option for Boot-managed blocking clients only). Off-list host, or empty/absent list → the 402 is returned unchanged and nothing is signed. `enabled` with no hosts → startup warning.
  - Schemes come from `X402ClientCustomizer` beans (Cardano client wiring: WP13).
  - Spend controls and prefer-policies come from YAML.
  - `X402ClientStarterTest` (fake scheme, WireMock):
    - an `@HttpExchange` interface, a `RestClient` and a `RestTemplate` built from Boot's builders pay a 402 from an allowed host
    - a self-built `RestClient` / `RestTemplate` bean is left unchanged and logs the warning; built with `x402Decorator.decorate(factory)`, it pays from an allowed host and gets the 402 back unpaid from an off-list host or with an empty list
    - no double instrumentation of Boot-built clients
    - an off-list host, or an empty list, gets the 402 back unpaid; a 402 whose `resource.url` host is off the list is not paid
    - wildcard vs apex matching
    - an over-cap price is refused; a non-default asset is refused unless it is listed in `allowed-assets`
- **`X402StarterContract`:** an abstract test over a real server (`@SpringBootTest(webEnvironment = RANDOM_PORT)`, a plain HTTP client, a WireMock facilitator, fake schemes) with abstract fixture hooks. Transport-neutral cases:
  - 402 shape; paid → 200 + `PAYMENT-RESPONSE`
  - handler 4xx/5xx and exception → cancel fired once, no settle, failure headers
  - settle failure → 402, body discarded; pending → retried once
  - upfront flow + handler 500 → cancel once, receipt echoed
  - unknown offer → context fails
  - class vs method annotation; path variables; consumes; HEAD charged
  - CORS pre-flight free; a more specific free handler stays free
  - YAML-only path route; context path + `;jsessionid` + `%2F`
  - overlap; Spring Security 401 before 402; `x402.enabled=false`; 204 no-body paid handler settles
- **MVC-only cases in `X402PaymentMvcTest`:** Callable; DeferredResult; DeferredResult timeout (503 async dispatch) → no settle; exception after async start → no settle; emitters rejected at startup.

## Proof commands
- red-first: ~/.claude/bin/red-first.sh <Base> --setup 'mvn -q -f java/pom.xml install -DskipTests' java/x402-spring-boot-autoconfigure/src/test/java/org/x402/spring/X402StarterContract.java java/x402-spring-boot-autoconfigure/src/test/java/org/x402/spring/web/servlet/X402PaymentMvcTest.java java/x402-spring-boot-autoconfigure/src/test/java/org/x402/spring/X402PropertiesBindingTest.java java/x402-spring-boot-autoconfigure/src/test/java/org/x402/spring/offer/OfferRegistryTest.java java/x402-spring-boot-autoconfigure/src/test/java/org/x402/spring/offer/MultiOptionOfferTest.java java/x402-spring-boot-autoconfigure/src/test/java/org/x402/spring/offer/OfferResolutionTest.java java/x402-spring-boot-autoconfigure/src/test/java/org/x402/spring/autoconfigure/StartupSyncTest.java java/x402-spring-boot-autoconfigure/src/test/java/org/x402/spring/client/X402ClientStarterTest.java -- mvn -f java/pom.xml -pl x402-spring-boot-autoconfigure test
- green: `mvn -B -f java/pom.xml verify -Pcoverage checkstyle:check spotbugs:check`
- scope: ~/.claude/bin/check-scope.sh docs/work/wp-5-spring-starter-webmvc.md

## Log
- 2026-10-12 Base: f8f83309 (no checkpoint commits, decision 001); prerequisite core 2.0.0-SNAPSHOT from ~/.m2.
- red-first (manual, decision 001): `mvn -B -pl x402-spring-boot-autoconfigure test` with `OfferResolutionTest`, `OfferRegistryTest`, `MultiOptionOfferTest`, `X402PropertiesBindingTest`, `StartupSyncTest`, `X402ClientStarterTest`, `X402StarterContract` + `X402PaymentMvcTest` written before any main code → BUILD FAILURE, 116 compilation errors (`package org.x402.spring.annotation does not exist`, `package org.x402.spring.properties does not exist`, `package org.x402.spring.client.servlet does not exist`, …). Test support (`FakeFacilitator`, `TestServerScheme`, `TestClientScheme`, `HookRecorder`, `TestAdapter`, `TestHttp`, `TestBinding`, `ContractApp`) written in the same step.
- red-first (manual, decision 001): security finding (paid retry follows redirects, decision 075). `PaidRedirectTest` written first → compile error (`decorate(factory, paidFactory)` missing); with a stub 2-arg `decorate` that ignored its second argument: 5/5 failed (`expected: 302`, the paid request was followed to the second WireMock origin on jdk, simple and reactor factories, and the 1-arg warning was absent).
- Test setup corrections after red-first (no assertion changed): env source name, no-offers app, `ContractApp` as `ImportSelector` (decision 060).
- Coverage tests added after implementation (they pin existing behaviour, so they are not red-first): `ServletAdapterInternalsTest` (9), `ClientFactoryEdgeTest` (9), `OfferRouteResolverTest` (4), `StarterConfigurationEdgeTest` (10), `ConfigurationMetadataTest` (1).
- green: `cd java && mvn -B -pl x402-spring-boot-autoconfigure verify -Pcoverage checkstyle:check spotbugs:check` → exit 0, BUILD SUCCESS; Tests run: 149, Failures 0, Errors 0, Skipped 0 (Check tests: OfferResolutionTest 29, OfferRegistryTest 9, MultiOptionOfferTest 5, X402PropertiesBindingTest 21, StartupSyncTest 8, X402ClientStarterTest 10, X402PaymentMvcTest 28 = contract 23 + MVC-only 5, PaidRedirectTest 5); jacoco instructions 0.958, branches 0.857; checkstyle 0 warnings; spotbugs 0 bugs. Re-run after core / cardano reinstall (WP12/WP8 additions): unchanged.
- Additions beyond the rule text (decisions 066, 067, 073, 075): `x402.sync.initial-backoff` / `x402.sync.max-backoff`; `x402.paywall.{app-name, app-logo, testnet}`; `X402RouteCustomizer`; `X402ResourceServerCustomizer.customizeHttp`; `x402Decorator.decorate(factory, nonRedirectingFactory)` and the non-redirecting paid factory for Boot-built clients. Decisions 060–075.
- Scope: files touched = java/x402-spring-boot-autoconfigure/** (pom, main, test, resources) and docs/** only.
- red-first (manual, decision 001): fail-closed transports (decision 143). `FailClosedTransportTest` (6) written first -> `mvn -B -pl x402-spring-boot-autoconfigure test -Dtest=FailClosedTransportTest`: 5 of 6 failed (redirect-following JDK factory/connector and opaque factory/connector paid; SimpleClientHttpRequestFactory followed the paid redirect); the JDK `NEVER` case already passed.
- green after decision 143: gate exit 0, Tests run 219, Failures 0, Errors 0; jacoco instructions 0.946, branches 0.835; checkstyle 0; spotbugs 0. `FailClosedTransportTest` 6/6.
- Process note (decision 001): the post-implementation coverage tests (ServletAdapterInternalsTest, ClientFactoryEdgeTest, OfferRouteResolverTest, StarterConfigurationEdgeTest, ConfigurationMetadataTest, ReactiveEdgeTest) are red at Base by non-compilation (their classes under test do not exist there); they were not run red before their code.
- red-first (manual, decision 001): `WrappedSimpleFactoryTest` (1) -> failed (`expected: 0`, the second origin received the paid request through a Buffering-wrapped Simple factory); green after the depth-0 rule (decision 143 addendum).
- red-first (manual, decision 001): review findings 2026-10-12 (decisions 144-150). New tests written first: `X402ReviewContract` + `X402ReviewMvcTest` (6) + `X402ReviewWebFluxTest` (6), `ReviewFindingsTest` (7). Run: 15 of 19 failed for the stated reasons (handler Location/token/cookie headers on the settle-failure 402 and the 502 on both stacks; rewrite/forward reached the paid handler unpaid; WebFlux settle interrupted when the client went away; WebClient replay lost Content-Type/multipart boundary; price.extra method not seen at startup; 402 without resource.url paid; paid response not closed when a response hook throws; path offer over a streaming handler accepted; re-sync died on an Error; no warning for an empty spend cap). The four passing cases are positive controls (settled redirect keeps headers, direct paid route). The empty-cap test was first written on an ApplicationContextRunner whose output is not captured; rewritten on SpringApplicationBuilder before logging, and red again.
- green after review findings (decisions 144-150): gate exit 0, Tests run 239, Failures 0, Errors 0; jacoco instructions 0.935, branches 0.836; checkstyle 0; spotbugs 0. Fixture changes before green (no assertion changed): the WebClient replay test uses a JDK connector on HTTP/1.1 with `forTransport` (BlockHound/h2c, decision 150).
- 2026-10-12 (orchestrator): the full autoconfigure gate failed once with `X402PaymentWebFluxTest>springSecurityAnswers401BeforeX402Answers402` — the test client reached a local H2 server (`Version mismatch … H2`) because `localhost` resolved to IPv6 where another process held the same port number. 3/3 isolated reruns green. Fixture fix: test URLs for the app server use `127.0.0.1` (no assertion changed; decision 014). Gate rerun → exit 0, 264 tests.
- red-first (manual, decision 001): review round 2 finding 11, `RetryCloseTest` (1) failed first (retry response not closed when the second hook call threw).
- green (review round 2): `cd java && mvn -B -pl x402-spring-boot-autoconfigure verify -Pcoverage checkstyle:check spotbugs:check` -> exit 0, BUILD SUCCESS; Tests run 277, Failures 0, Errors 0; jacoco instructions 0.942, branches 0.840; checkstyle 0; spotbugs 0. Decisions 153-160. Cross-package edits of this round: `X402AutoConfiguration` (defaults SPIs), `OptionDraft`/`OfferResolver` (declared extra, timeout), `X402WebFilter` (`offload` public), `X402ClientHttpRequestFactory` (retry close), new root types `X402SchemeDefaults`, `X402ClientSchemeDefaults`, `ClientSchemes`.
