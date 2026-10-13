# 154 — The WebFlux facilitator endpoints run the handler cancel-immune

**Context.** Review round 2, finding 2. `FacilitatorRoutes` used `Mono.fromCallable(...).subscribeOn(boundedElastic())`. A client that dropped a slow settle interrupted the worker inside `submitTransaction`. The interrupted thread then made the evidence read fail, so the claim could be marked submitted for a transaction that never reached the node, and the seller would never be paid.

**Decision.** The route uses `X402WebFilter.offload` (decision 147, now public): a `CompletableFuture` on `boundedElastic`, wrapped with `Mono.fromFuture(supplier, true)`, so a started call is never interrupted.

**Test.** `FacilitatorCancelWebFluxTest`: a 1 s settle, client timeout 300 ms → the settle completes and is never interrupted. Red first ("interrupted").

**Reverse.** Back to `fromCallable().subscribeOn()`.
