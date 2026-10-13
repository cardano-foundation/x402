# 078 — WebClient: the paid request never follows a redirect

**Context.** Decision 075 for blocking clients; the orchestrator asked for the same on WebClient. Plan §2 says "a `WebClient` follows redirects only if its connector is configured to (Reactor Netty's default is off)". For Boot 3.5 that is wrong: `ClientHttpConnectorSettings` defaults `redirects` to `FOLLOW_WHEN_POSSIBLE`, which `ReactorHttpClientBuilder` maps to following. So every Boot-built WebClient follows redirects unless `spring.http.reactiveclient.redirects=dont-follow` is set. A filter cannot switch a connector's redirect behaviour per request.

**Decision.**
- A `BeanPostProcessor` wraps Boot's `ClientHttpConnectorBuilder` bean. The connector it builds is an `X402ClientHttpConnector` holding the configured connector and a twin built from the same settings with `HttpRedirects.DONT_FOLLOW`.
- The x402 filter sends the paid exchange through `next` as usual, so later filters still run (plan: retry at x402's position in the chain), and marks it in the Reactor context (`X402ExchangeFilterFunction.PAID_REQUEST`). The connector picks the twin for marked exchanges. A 3xx answer to a paid request reaches the caller unfollowed.
- Self-built WebClients keep their own connector. If it is Reactor Netty with redirect following on (`HttpClientRequest.isFollowRedirect()`, checked in the paid request's `httpRequest` callback before anything is sent), the paid request is refused with an `X402ClientException` and nothing is sent. Other self-built connectors (JDK, Jetty, Apache) cannot be checked; the README must say to configure them not to follow redirects.
- Tests (red first, in `X402WebClientStarterTest`): a Boot-built WebClient with `redirects=follow` returns the 302 and the second origin is never contacted; a self-built following Reactor connector refuses the paid request and sends nothing.

**Alternatives.** Bypass `next` with an own exchange function for the paid request (skips filters registered after x402); warn only (leaves the default configuration leaking).

**Consequences.** Boot-built WebClients hold two connectors. `reactor-netty-http` is an optional compile dependency of the autoconfigure module, used only when present.

**Plan text.** §2's redirect bullet should read: Boot-built blocking clients and WebClients follow redirects by default, but x402 sends the paid request through a non-redirecting twin (decisions 075, 078); self-built clients must supply or configure a non-redirecting transport.

**Reverse.** Remove the connector post-processor and the context marker.
