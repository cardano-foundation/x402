# 146 — A dispatch guard fails closed when a paid handler is reached unprocessed

**Context.** Review finding 3. The filter decides the offer from Spring's handler lookup at its own position in the chain. A forward or include (the filter only runs on `REQUEST`/`ASYNC`), a URL-rewriting filter after x402, or any other mismatch could dispatch to a paid handler that was never charged.

**Decision.**
- The filters record the decided offer in the request/exchange attribute `OfferRegistry.DECIDED_OFFER`, for every decision, including a protected-request hook that grants access.
- MVC: `X402DispatchGuard`, a `HandlerInterceptor` at the highest precedence. A `HandlerMethod` whose annotated offer differs from the decided one is not run: 500 `{"error":"Internal Server Error"}`, with an error log naming the handler, the offer and the dispatch type.
- WebFlux: `X402DispatchGuardHandlerAdapter`, a highest-precedence `HandlerAdapter` for handler methods that belong to an offer. It errors with 500 on a mismatch and otherwise delegates to `RequestMappingHandlerAdapter`.
- Only annotated offers are checked. `path:` offers are decided by path in the filter and have no handler identity to compare.

**Consequences.** Tests that call paid handlers without the x402 filter (e.g. `MockMvc` built without filters) now get 500. Boot's `@AutoConfigureMockMvc` adds filters by default.

**Tests.** A lowest-precedence rewrite filter on both stacks, and a servlet forward. The handler does not run and the facilitator is never called.

**Reverse.** Remove the interceptor and the adapter.
