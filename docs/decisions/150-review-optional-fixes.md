# 150 — Path offers over streaming handlers, an unkillable re-sync, a warned empty cap

**Context.** Review findings 9, 10 and 11.

**Decision.**
- A `path:` offer that settles after the handler fails startup when it matches a streaming handler without an annotation. Annotated handlers win, as before.
- `X402ServerLifecycle.resync` catches every `Throwable` except `VirtualMachineError`, logs it, and reschedules, so a throwing scheme or facilitator cannot stop the single-flight re-sync.
- A blank `x402.client.spend-controls.max-amount-per-payment` (no USD cap, decision 068) logs a startup warning.
- Test fixtures: the new WebClient replay test uses a JDK connector on HTTP/1.1 declared via `forTransport` (Reactor Netty's lazy resolver init reads a file on the event loop, which the JVM-wide BlockHound flags; WireMock resets JDK h2c upgrades).

**Tests.** `ReviewFindingsTest#aPathOfferMatchingAStreamingHandlerFailsStartup`, `#aResyncSurvivesAnError`, `#anEmptySpendCapWarnsAtStartup`.

**Reverse.** Local to `OfferRegistry`, `X402ServerLifecycle` and `X402AutoConfiguration`.
