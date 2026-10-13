# 067 — `x402.paywall.*` shape

**Context.** The plan only shows `x402.paywall.enabled`. Core takes a `PaywallConfig` and decides "browser" from `Accept` + `User-Agent`.

**Decision.** `x402.paywall.{enabled (default true), app-name, app-logo, testnet}` → a `PaywallConfig` bean (backs off). With `enabled=false` the adapter reports an empty `User-Agent`, so core never takes the browser path and 402s stay JSON. A `PaywallProvider` bean is registered on the HTTP server; without one core serves its static fallback page.

**Reverse.** Drop the extra keys; keep `enabled`.
