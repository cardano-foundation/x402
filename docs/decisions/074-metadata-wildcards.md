# 074 — Metadata for map values and list elements uses `*` and `[]`

**Context.** The configuration processor emits nothing for `Map<String, Pojo>` values or list elements.

**Decision.** `additional-spring-configuration-metadata.json` lists `x402.accounts.*.…`, `x402.routes.*.…`, `x402.routes.*.accepts[].…`, `x402.facilitators[].…`, `x402.client.spend-controls.allowed-assets[].…` and `x402.client.cardano.networks[].…` with types and descriptions. The spec defines no placeholder syntax; these names document the shape for IDE search and the README.

**Reverse.** Delete the file.
