# 033 — The static fallback paywall names `PaywallProvider` instead of `@x402/paywall`

**Context.** TS serves a fixed page without any request-derived content when `@x402/paywall` is missing (`x402HTTPResourceServer.ts:383-401`). Its developer note tells the reader to install the npm package, which means nothing to a Java developer.

**Decision.** `src/main/resources/org/x402/http/fallback-paywall.html` is the TS page with the same structure and still zero interpolation; only the developer note says "register a `PaywallProvider`". Precedence as TS: route `customPaywallHtml`, then a registered `PaywallProvider`, then the fallback.

**Alternatives.** Byte-identical TS text (misleading for Java users).

**Reverse.** Replace the note with TS's sentence.
