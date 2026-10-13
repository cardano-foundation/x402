# 063 — The selected offer travels on the HTTP adapter

**Context.** The filter decides the offer from Spring's handler lookup (annotation first, then `path:` routes). Core's `X402HttpResourceServer` resolves routes itself through a `RouteResolver`, also again when building a settle-failure body; both must agree.

**Decision.** Route keys are offer names (`OfferRouteResolver`). The stack adapters implement `OfferSelection`; `OfferRouteResolver.resolve` returns exactly the selected offer for such adapters and falls back to TS pattern matching over `path:` offers only for plain contexts. Path matching tries the raw path, then the decoded one (TS), and for `HEAD` also `GET` patterns, because Spring dispatches HEAD to GET handlers (plan: HEAD on a paid GET is charged). The hooks' `routePattern` is Spring's best-matching pattern for annotated handlers and the offer's `path` otherwise.

**Alternatives.** A thread-local or request attribute read by the resolver (hidden coupling, wrong under async offload).

**Reverse.** Replace `OfferSelection` with a request attribute.
