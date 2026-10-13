# 073 — `X402RouteCustomizer` seam; extension declarations pass through

**Context.** WP9b adds bazaar declarations from YAML; other route fields (custom 402 bodies) have no YAML form.

**Decision.** `x402.routes.<name>.extensions` binds to a `Map` and is passed to core unchanged (TS passes declaration objects as given). `X402RouteCustomizer` beans (`(offer, RouteConfig) → RouteConfig`) run after resolution and contributors, so WP9b and applications can convert declarations or set `unpaidResponseBody` / `settlementFailedResponseBody`. `X402ResourceServerCustomizer` gained a default `customizeHttp(X402HttpResourceServer)` for protected-request hooks.

**Reverse.** Remove the customizer interfaces.
