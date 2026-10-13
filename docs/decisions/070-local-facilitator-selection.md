# 070 — Which bean is the local facilitator

**Context.** WP5: with `x402.local-facilitator=true` a `LocalFacilitatorClient` bean (WP12) is prepended as `local`; without one, startup fails pointing to `x402.facilitator-server`. Core now offers `X402ResourceServer.Builder.localFacilitator(client)` and the `InProcessFacilitatorClient` marker.

**Decision.** The starter picks the single `FacilitatorClient` bean implementing `InProcessFacilitatorClient`; if there is none, the single one whose identifier normalizes to `local`; zero or several → startup error naming `x402.facilitator-server`. It is passed to `localFacilitator(...)`. A YAML entry whose effective identifier is `local` fails as reserved. `FacilitatorClient` beans are otherwise not added to the list (YAML is the source of truth).

**Reverse.** Local to `X402AutoConfiguration.localFacilitator`.
