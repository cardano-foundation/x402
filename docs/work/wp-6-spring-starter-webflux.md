# WP-6: the starter contract holds on WebFlux without blocking the event loop or leaking buffers
Tier: R2
Base: <git rev-parse HEAD at package start>
Check: `X402PaymentWebFluxTest` (extends `X402StarterContract`) passes with BlockHound installed and a leak-detecting `DataBufferFactory`

## Allowed files
- java/x402-spring-boot-autoconfigure/src/main/java/org/x402/spring/web/reactive/**
- java/x402-spring-boot-autoconfigure/src/main/java/org/x402/spring/autoconfigure/X402WebFluxAutoConfiguration.java
- java/x402-spring-boot-autoconfigure/src/main/java/org/x402/spring/client/reactive/**
- java/x402-spring-boot-autoconfigure/src/main/resources/META-INF/spring/**
- java/x402-spring-boot-autoconfigure/src/test/java/org/x402/spring/web/reactive/**
- java/x402-spring-boot-autoconfigure/pom.xml
- docs/**

## Rules
- `X402StarterContract` and `OfferRegistry` are read-only here. If either needs a change, stop and report: the contract's tests are immutable after WP5's red-first.
- A reactive `HandlerMethodSource` for `OfferRegistry` (reactive `RequestMappingHandlerMapping#getHandlerMethods()`). Its `isStreaming` flags `text/event-stream` produces, `Flux<ServerSentEvent>` and streaming `Flux` media types.
- `X402WebFilter` (`WebFilter`, ordered after Spring Security's `WebFilterChainProxy`):
  - skips CORS pre-flight
  - resolves the winning handler through the `DispatcherHandler`'s handler mappings (`getHandler(exchange)`) → `HandlerMethod` → offer; falls back to `PatternRouteResolver` with the path within the application
  - runs every core call via `Mono.fromCallable(...).subscribeOn(Schedulers.boundedElastic())`
  - buffers with a `ServerHttpResponseDecorator` that overrides **`writeWith`, `writeAndFlushWith` and `setComplete`**, so no-body responses (204, `Mono<Void>`) are settled too
  - follows the WP4 adapter contract (cancel / settle / 402 / 502)
  - releases every `DataBuffer` on every path
- Streaming paid handlers are refused at startup by `OfferRegistry` through the reactive source's `isStreaming`. No `OfferRegistry` change is needed.
- Client: `ExchangeFilterFunction` for `WebClient`, applied through a `WebClientCustomizer` to Boot's `WebClient.Builder` behind `x402.client.enabled`, in `org.x402.spring.client.reactive`.
  - Its auto-configuration is **separate** from the reactive server's. It is `@ConditionalOnClass(WebClient.class)` only, so a servlet app using WebClient gets it too (tested in a servlet app).
  - Body: the filter wraps the `BodyInserter` to record bytes during the first send, up to `max-replay-body`. A body that is too large or can't be recorded → the 402 is returned unpaid, nothing signed. Test: a single-use publisher.
  - The first `ClientResponse` is released (`releaseBody()`) before the retry.
  - `X402WebClientBeanPostProcessor` (in `org.x402.spring.client.reactive`, active only when WebClient is on the classpath) replaces self-built `WebClient` beans with `mutate().filter(…).build()`, with the same marker guard as WP5.
  - The same YAML as WP5: spend controls, prefer, `hosts`, `instrument-beans`.
  - The paid request never follows a redirect (decision 078, correcting the plan's "Reactor Netty's default is off": Boot 3.5 connectors follow by default). Boot's `ClientHttpConnectorBuilder` is wrapped so the paid exchange, marked in the Reactor context, goes through a twin connector built with `DONT_FOLLOW`; a self-built Reactor Netty connector that follows redirects gets the paid request refused before anything is sent.
  - Signing runs on `boundedElastic`.
  - `X402WebClientStarterTest` lives in `src/test/java/org/x402/spring/web/reactive/`. It covers: WireMock 402 → paid from an allowed host; an off-list host → 402 returned unpaid; a self-built bean pays; over-cap refused.
- The reactive **server** auto-configuration is `@ConditionalOnWebApplication(type = REACTIVE)`; the client one is not. BlockHound allowlist only for logging appenders, if needed (log it).

## Proof commands
- red-first: ~/.claude/bin/red-first.sh <Base> --setup 'mvn -q -f java/pom.xml install -DskipTests' java/x402-spring-boot-autoconfigure/src/test/java/org/x402/spring/web/reactive/X402PaymentWebFluxTest.java -- mvn -f java/pom.xml -pl x402-spring-boot-autoconfigure test
- green: `mvn -B -f java/pom.xml verify -Pcoverage checkstyle:check spotbugs:check`
- scope: ~/.claude/bin/check-scope.sh docs/work/wp-6-spring-starter-webflux.md

## Log
- 2026-10-12 Base: f8f83309 (no checkpoint commits, decision 001); WP5 complete in the same tree.
- red-first (manual, decision 001): `X402PaymentWebFluxTest` (contract 23 + reactive-only 5, BlockHound, `LeakTrackingBuffers` leak-detecting factory) written before any reactive main code → `mvn -B -pl x402-spring-boot-autoconfigure test -Dtest=X402PaymentWebFluxTest` (WebClient test parked outside the tree for this run): Tests run 28, Failures 24, Errors 1 (no x402 web filter: paid handlers answered 200 unpaid, streaming handler not refused). `X402WebClientStarterTest` (10 cases incl. decision-075 redirect cases) → compilation error `cannot find symbol org.x402.spring.client.reactive.X402ExchangeFilterFunction`.
- Fixture corrections after red-first, no assertion changed (decision 076): Netty pinned (Tomcat was serving the reactive app), bound to `::`, per-context `ReactorResourceFactory`, reactive user store for the security variant.
- Rule text corrected (decision 078): paid WebClient requests never follow redirects; the plan §2 redirect bullet needs the same correction (plan owned by the orchestrator).
- Coverage test added after implementation (not red-first): `ReactiveEdgeTest` (7).
- green: `cd java && mvn -B -pl x402-spring-boot-autoconfigure verify -Pcoverage checkstyle:check spotbugs:check` → exit 0, BUILD SUCCESS; Tests run: 194, Failures 0, Errors 0, Skipped 0 (WP6 Check: X402PaymentWebFluxTest 28 = contract 23 + reactive-only 5, under BlockHound, every pooled buffer released after each test; X402WebClientStarterTest 10); jacoco instructions 0.946, branches 0.839; checkstyle 0 warnings; spotbugs 0 bugs. Decisions 076–079.
- Scope: java/x402-spring-boot-autoconfigure/** (pom: optional `reactor-netty-http`) and docs/** only.
- red-first (manual, decision 001): fail-closed transports (decision 143). `FailClosedTransportTest` (6) written first -> `mvn -B -pl x402-spring-boot-autoconfigure test -Dtest=FailClosedTransportTest`: 5 of 6 failed (redirect-following JDK factory/connector and opaque factory/connector paid; SimpleClientHttpRequestFactory followed the paid redirect); the JDK `NEVER` case already passed.
- green after decision 143: gate exit 0, Tests run 219, Failures 0, Errors 0; jacoco instructions 0.946, branches 0.835; checkstyle 0; spotbugs 0. `FailClosedTransportTest` 6/6.
- Process note (decision 001): the post-implementation coverage tests (ServletAdapterInternalsTest, ClientFactoryEdgeTest, OfferRouteResolverTest, StarterConfigurationEdgeTest, ConfigurationMetadataTest, ReactiveEdgeTest) are red at Base by non-compilation (their classes under test do not exist there); they were not run red before their code.
- red-first (manual, decision 001): review findings 2026-10-12 (decisions 144-150). New tests written first: `X402ReviewContract` + `X402ReviewMvcTest` (6) + `X402ReviewWebFluxTest` (6), `ReviewFindingsTest` (7). Run: 15 of 19 failed for the stated reasons (handler Location/token/cookie headers on the settle-failure 402 and the 502 on both stacks; rewrite/forward reached the paid handler unpaid; WebFlux settle interrupted when the client went away; WebClient replay lost Content-Type/multipart boundary; price.extra method not seen at startup; 402 without resource.url paid; paid response not closed when a response hook throws; path offer over a streaming handler accepted; re-sync died on an Error; no warning for an empty spend cap). The four passing cases are positive controls (settled redirect keeps headers, direct paid route). The empty-cap test was first written on an ApplicationContextRunner whose output is not captured; rewritten on SpringApplicationBuilder before logging, and red again.
- green after review findings (decisions 144-150): gate exit 0, Tests run 239, Failures 0, Errors 0; jacoco instructions 0.935, branches 0.836; checkstyle 0; spotbugs 0. Fixture changes before green (no assertion changed): the WebClient replay test uses a JDK connector on HTTP/1.1 with `forTransport` (BlockHound/h2c, decision 150).
