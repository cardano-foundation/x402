# 076 — WebFlux test fixture corrected after red-first; how leaks are detected

**Context.** `X402PaymentWebFluxTest` was logged red (decision 001). Going green exposed three defects in its stack-specific fixture (the shared `X402StarterContract` was not touched):
1. With Tomcat on the test classpath (needed by the MVC tests), Boot runs a reactive app on Tomcat's reactive adapter, not Reactor Netty. Tomcat rejects `%2F` with 400, its buffers are not pooled (so the leak tracker saw nothing), and BlockHound would not watch Netty event loops.
2. Reactor Netty binds IPv4 `0.0.0.0`; the contract connects to `localhost`, which resolves to `::1` first on macOS.
3. Every variant context's `ReactorResourceFactory` disposed Reactor Netty's global event loops on close, stopping the main test server.
4. The security variant had no reactive user store, so `httpBasic()` could not build.

**Decision.** `FluxApp` declares a `NettyReactiveWebServerFactory` bound to `::` (dual stack) using a per-context `ReactorResourceFactory` with `useGlobalResources=false`; the security variant declares a `MapReactiveUserDetailsService`. No assertion changed.

**Leak detection.** Spring's `LeakAwareDataBufferFactory` is a test fixture, not a published artifact. `LeakTrackingBuffers` is an outermost `WebFilter` that gives each response a `DataBufferFactory` recording every pooled buffer it creates; `X402PaymentWebFluxTest` checks after every test that all of them were released. The x402 decorator, the handler's encoders and the filter's own writes all allocate through it.

**Reverse.** Drop the factory beans (tests then run on Tomcat).
