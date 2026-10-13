# 077 — WebFlux filter details

**Context.** WP6 fixes the outline (handler lookup through the `DispatcherHandler`, `boundedElastic` offload, a decorator covering `writeWith` / `writeAndFlushWith` / `setComplete`); details were open.

**Decision.**
- **Handler lookup** runs the dispatcher's mappings on an exchange decorator with a private attribute map and a private copy of the response headers. Reactive `getHandler` runs CORS processing, which would otherwise write `Vary` / `Access-Control-*` headers to the real response. A mapping that errors (e.g. 415) means "no handler", as on the servlet side.
- **Paths**: raw = `pathWithinApplication()` segments with `;` parameters cut off; decoded = each segment's `valueToMatch()`.
- **Offload**: `processHttpRequest`, `processSettlement`, cancel and failure-header computation run in `Mono.fromCallable(...).subscribeOn(Schedulers.boundedElastic())`. Nothing in the filter blocks on the event loop; `X402PaymentWebFluxTest` runs under BlockHound.
- **Buffering**: every `DataBuffer` is copied and released at once (with a discard hook), so nothing is held across the facilitator call. Status and headers go to the real response, which is committed only when the filter writes. `Settlement-Overrides` is read, then removed from the real headers before commit.
- **Outcomes** as in decision 065: ≥ 400 or handler error → cancel (`handler_failed` / `handler_threw`), failure headers, no settle; settle failure → its 402; `FacilitatorResponseException` → 502; other processing errors → 500; route unavailable → 503 + `Retry-After: 5` or 500. A cancelled subscription (client gone) cancels the payment on `boundedElastic`; nothing is settled.
- **Streaming**: the reactive source refuses `Flux<ServerSentEvent>` and `text/event-stream`, NDJSON or `application/stream+json` produces on settle-after-handler offers. Upfront offers may stream, but the stream is buffered until the filter writes (`writeAndFlushWith` collapses into one write).
- **Order**: `x402.filter-order`, default −99, right after `WebFilterChainProxy` (−100).

**Reverse.** Local to `org.x402.spring.web.reactive`.
