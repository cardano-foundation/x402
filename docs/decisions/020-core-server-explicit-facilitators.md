# 020 — The core resource server needs an explicit facilitator list

**Context.** TS `new x402ResourceServer()` without clients creates an `HTTPFacilitatorClient` for `https://x402.org/facilitator`. In Java that client lives in `org.x402.http`, which depends on `org.x402.core.server`; defaulting inside core would create a package cycle.

**Decision.** `X402ResourceServer.builder().build()` with no facilitator throws `IllegalArgumentException` naming the TS default. The default URL is applied where configuration happens: `HttpFacilitatorClient.builder().build()` (WP4) uses `https://x402.org/facilitator`, and the Spring starter (WP5) adds that entry when `x402.facilitators` is empty.

**Alternatives.** Load the HTTP client reflectively from core (hidden coupling); move the HTTP client into core (mixes layers).

**Consequences.** Plain-Java users write one line more than in TS. Behaviour with a configured list is unchanged.

**Reverse.** Add a default in the builder via a small `FacilitatorClient` supplier SPI.
