# 012 — Cross-origin redirects drop credential and payment headers

**Context.** With a `HostPolicy`, `X402HttpClient` follows redirects itself (plan §2). The first version copied every request header to each hop. An automated security review flagged that `Authorization`, cookies and `PAYMENT-SIGNATURE` would then reach another origin. A regression test confirmed it.

**Decision.** When a redirect changes the origin (scheme, host or effective port), the next request drops `Authorization`, `Cookie`, `Proxy-Authorization`, `X-Api-Key`, `PAYMENT-SIGNATURE` and `X-PAYMENT`, as the browser fetch spec does for credentials. Same-origin hops keep all headers. Other headers and replayable bodies are kept. Test: `X402HttpClientRedirectHeadersTest`.

**Alternatives.** Refuse cross-origin redirects entirely (breaks legitimate CDN / auth redirects); strip all headers (breaks content negotiation).

**Consequences.** A paid request redirected to another allowed origin arrives there without the payment; the new origin answers 402, and the client's "already attempted" guard stops a second payment.

**Reverse.** Change `CROSS_ORIGIN_STRIPPED` in `X402HttpClient`.
