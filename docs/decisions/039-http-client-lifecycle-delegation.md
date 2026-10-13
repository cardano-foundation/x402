# 039 — `X402HttpClient` delegates the JDK 21 lifecycle and is `AutoCloseable`

**Context.** WP4: `wrap` returns an `HttpClient` subclass "delegating every other method". JDK 21 added `close()`, `shutdown()`, `shutdownNow()`, `awaitTermination(Duration)` and `isTerminated()` to `HttpClient`. The module compiles for Java 17, so those methods cannot be overridden with `@Override`; the base implementations would then act on the wrapper, not on the delegate.

**Decision.** The wrapper declares the five methods (no `@Override`); on JDK 21+ they override the base methods at runtime and invoke the delegate's by reflection; on 17–20 they do nothing / return `false`. The class also implements `AutoCloseable`, so try-with-resources works on every runtime. `X402HttpClientLifecycleTest` (red first) runs on JDK 21+ and is skipped below.

**Alternatives.** Leave them undelegated (a closed wrapper would leave the delegate's threads running on 21+).

**Reverse.** Replace reflection with direct calls once the baseline is Java 21.
