# 178 — Java e2e servers: catalog handlers registered on Spring's mapping, `/exact/cardano/default` annotated

**Context.** WP10: offers use YAML `path:`, and one route is additionally served by an `@X402Payment` controller, so the annotation path runs in e2e. A `path:` offer protects whatever handler Spring dispatches to. The starter warns at startup when a `path:` matches no registered handler (plan rule 4), so every catalog path needs a real handler. The paths come from the catalog, so they cannot be literal `@GetMapping` values.

**Decision.**
- **Catalog handlers.** A static `BeanPostProcessor` (`CatalogRouteMappings`, one per stack) registers one GET mapping per `path:` route on Spring's `requestMappingHandlerMapping`, right after that bean is initialized. The handler answers the standard body `{"message":"Protected endpoint accessed successfully","timestamp":…}` (MVC `ResponseEntity`; WebFlux `Mono<ResponseEntity>`). Because the mappings exist before the x402 offer registry reads them, both servers start with no x402 warnings.
  - MVC uses `mapping.getBuilderConfiguration()`.
  - WebFlux has no such accessor, so it builds a `BuilderConfiguration` with `mapping.getPathPatternParser()`.
- **Annotated route.** `/exact/cardano/default` is served by `AnnotatedRouteController` with `@X402Payment("exact-cardano-default")`. Its offer has no `path:`.
  - The controller is `@ConditionalOnProperty(e2e.annotated-route=true)`. `E2eServerConfig` sets that property only when the catalog route is present. The annotation therefore never names a missing offer, which would be a startup error under plan rule 1.
  - The path and offer name are compile-time constants, because annotation values must be.
- `GET /health` (`{status, version, routes}`) and `POST /close` (answers, then `SpringApplication.exit` after 100 ms) are plain controllers. `Server listening on http://localhost:<port>` is printed on `ApplicationReadyEvent`, after the x402 facilitator sync and with the web server accepting connections.

**Alternatives.**
- A catch-all `@GetMapping("/exact/**")`: noisy "matches no handler" warnings, and free 200s on non-catalog paths.
- `RouterFunction`s: the x402 filters look up `HandlerMethod`s for annotations.
- Annotating every route: the YAML `path:` mechanism would not run in e2e.

**Consequences.** The default route exercises the annotation path. Script (and Masumi, when configured) exercise `path:`. Both paid successfully on preprod on both stacks.

**Reverse.** Move the annotated route to another catalog path by changing `ANNOTATED_PATH` / `ANNOTATED_OFFER`.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
