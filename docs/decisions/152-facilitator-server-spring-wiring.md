# 152 — Spring facilitator server wiring details

**Context.** WP12 fixes the outline (YAML-built facilitator, routers, local client, §3a override points). Several details were open.

**Decision.**
- **Routes:** exactly `{base}/verify`, `{base}/settle` and `{base}/supported` are routed, with any method. `FacilitatorHttpHandler` answers 405 for a wrong method and owns the wire table. A root base path therefore does not capture the application's other routes. WebFlux reads the body, then runs the handler on `boundedElastic`; it is BlockHound-clean in the tests.
- **Registration order:**
  1. `X402FacilitatorCustomizer` beans run, in order;
  2. `FacilitatorExtension` beans are registered, in order;
  3. the claimed (scheme, network) pairs are read from `getSupported()`, and a Cardano scheme is registered only for unclaimed configured networks.

  Core facilitator routing is first-registered-wins, so a customizer's scheme for `cardano:mainnet` takes over while preprod stays auto.
- **Shared and optional beans:**
  - One `SettlementClaimStore` (bounded in-memory default, on the `Clock` bean if any) serves every network. Claims are keyed by transaction hash.
  - A `Clock` bean is used when present; the starter defines none, so it never collides with an application's own.
  - `PendingSettlementStore` (in-memory default) is provided for custom mechanisms; the Cardano scheme does not use it.
- **Backends:** `X402CardanoNetworkBeans.chainBackend(network)`, else a single plain `CardanoChainBackend` bean (one network only; with several it is a startup error naming the provider), else Blockfrost from YAML. Blockfrost needs `project-id` unless `base-url` is set.
- **Introspection:** `CardanoFacilitatorSchemes` exposes `forNetwork`, `backend` and `options` per network. Since the scheme's `verify`/`settle` are final (decision 121), wrapping is composition.
- **Local client:** `LocalFacilitatorClient` is a bean only with `x402.local-facilitator=true`. WP5 picks it as the `local` facilitator (decision 070).
- **Warning:** `confirmation-timeout` above 85 s is logged at startup.

**Alternatives.** Route `{base}/**` (a root base path would swallow every route); one claim store per network (a transaction hash is unique anyway).

**Reverse.** Local to `org.x402.spring.facilitator`.
