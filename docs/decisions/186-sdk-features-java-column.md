# 186 — The Java column of `docs/sdk-features.md`

**Context.** WP11: add a Java column that reflects only what is implemented (`docs/AGENTS.md`). Some rows don't map one-to-one.

**Decision.**
- **Networks / mechanisms:** `cardano` and `exact` on cardano (`default`, `masumi`, `script`) ✅; everything else ❌.
- **HTTP integrations:** server "Spring WebMvc, Spring WebFlux"; client "java.net.http, Spring RestClient / RestTemplate / WebClient".
- **Extensions:** bazaar (server) ✅; the bazaar facilitator client, builder-code, sign-in-with-x, payment-identifier, offer-receipt and gas sponsoring ❌.
- **Hooks:** client hooks ✅ except `onPaymentRequired (HTTP)` ❌ (no such hook in `X402HttpClient`); server and facilitator hooks ✅; `enrichDeclaration`, `enrichPaymentRequiredResponse`, `enrichSettlementResponse` ✅ (`ResourceServerExtension`).
- **Hook adapters:** scheme-level ✅ (`SchemeServerHooks`, `SchemeClientHooks`); extension-level server lifecycle ✅ and server HTTP transport ✅ (`HttpResourceServerExtension.onProtectedRequest`); extension-level client lifecycle and client HTTP transport ❌ (no client extension SPI).
- **MCP:** ❌ throughout.
- **HTTP server features:** `dynamicPayTo`, `dynamicPrice` ✅; paywall "❌ (static fallback page)": there is a `PaywallProvider` SPI and a static page, no Cardano paywall UI.
- **Client safety:** spend controls ✅.

**Alternatives.** ✅ for the paywall (overstates it); leaving Java out until more mechanisms exist.

**Consequences.** None beyond the page.

**Reverse.** Remove the column.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
