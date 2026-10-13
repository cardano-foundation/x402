# 075 — A paid request is never redirected

**Context.** Security review (2026-10-12, confirmed by the orchestrator): the blocking client's paid retry went through the same request factory as the first request. Boot 3.4+ blocking clients follow redirects by default, and the JDK, Apache, Reactor and `HttpURLConnection` transports copy request headers on redirect. So an allowed host answering the **paid** request with a 3xx to another origin got `PAYMENT-SIGNATURE` forwarded there. Plan §2 accepted trust-on-redirect only for the unpaid first request.

**Decision.**
- `X402ClientHttpRequestFactory` has a separate *paid delegate*; the request carrying `PAYMENT-SIGNATURE` goes only through it. `wrap(factory, paidFactory, client, hostPolicy)` sets it; the 3-argument `wrap` uses the same factory.
- Boot-built clients: the `ClientHttpRequestFactoryBuilder` post-processor builds the paid delegate from the same settings with `Redirects.DONT_FOLLOW`, so TLS, proxy and timeouts match, and a 3xx answer to a paid request is returned to the caller unfollowed.
- Self-built clients: `x402Decorator.decorate(factory, nonRedirectingFactory)` is the recommended form. The 1-argument `decorate(factory)` still pays (it cannot reliably tell whether an arbitrary factory follows redirects) but logs a startup warning naming the 2-argument form.
- WebClient (WP6): the paid exchange cannot switch off a connector's redirect following per request; see the WP6 log and decision for what the filter does.
- `PaidRedirectTest` (red first): jdk, simple and reactor factories with `spring.http.client.redirects=follow`, `RestClient` and `RestTemplate`, and the 2-argument decorator never forward the paid request; the 1-argument form warns.

**Alternatives.** Refuse to pay with the 1-argument form (breaks the documented fix in plan §2); detect redirect settings by reflection per factory type (fragile, incomplete).

**Consequences.** Boot-built clients hold two factories (two connection pools for pooling transports). A paid request whose server legitimately redirects (e.g. to a CDN) returns the 3xx to the caller.

**Reverse.** Build the paid delegate with the caller's redirect setting (reintroduces the leak).
