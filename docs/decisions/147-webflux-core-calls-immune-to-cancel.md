# 147 — WebFlux core calls, once started, survive a cancelled subscription

**Context.** Review finding 4. `Mono.fromCallable(...).subscribeOn(boundedElastic())` interrupts the worker when the subscription is cancelled, e.g. when the client goes away. A settle that had already reached the facilitator could be aborted mid-flight, after the payment was broadcast, without its hooks running.

**Decision.** `X402WebFilter.offload` runs every core call (`processHttpRequest` including before-handler settles, `processSettlement`, cancels) as a `CompletableFuture` on `boundedElastic`, wrapped with `Mono.fromFuture(supplier, true)`. Cancel suppression means that once started, the call completes and its hooks run; only the result is discarded.

**Tests.** `X402ReviewWebFluxTest#aSettleThatStartedCompletesWhenTheClientGoesAway`: a 1.5 s settle and a client timeout of 400 ms. The settle completes, the after-settle hook fires once, and nothing is cancelled.

**Reverse.** Back to `fromCallable().subscribeOn()`.
