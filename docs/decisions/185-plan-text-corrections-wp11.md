# 185 — Plan text aligned with the code (WP11)

**Context.** The orchestrator's instruction for WP11: the binding classes are the truth; where the plan differs, follow the code and correct the plan. Writing the README against the code found four places.

**Decision.** The plan now says:
1. **YAML quoting.** Only `${…}` placeholders must be quoted inside flow collections. SnakeYAML 2.4, which Spring Boot 3.5 ships, accepts `{ network: cardano:preprod }`; the plan claimed it was rejected (checked with SnakeYAML 2.4 directly). The examples and README still quote CAIP-2 ids there, for YAML 1.1 parsers.
2. **Self-built `RestClient` / `RestTemplate` fix** (§2 table): `x402Decorator.decorate(factory, nonRedirectingFactory)`. The one-argument form pays only over a verifiably non-redirecting transport (decision 143), so it is not the general fix.
3. **Facilitator hook example** (§3a): the result type is `HookResults.Decision.proceed()` / `abort(reason)`, not `VerifyHookResult`.
4. **Change map:** `examples/java/clients/spring-rest-client` (decision 180).

**Alternatives.** Leave the plan as historic text and correct only the README (the plan is still the reference for reviewers).

A fifth correction ("no `x402-facilitator` health indicator") was made and reverted the same day: decision 160 added the indicator while WP11 ran.

**Consequences.** Editorial only; no design changed, so no new spec review (per the user's guide).

**Reverse.** Revert the four edits in `docs/plans/2026-10-12-java-v2-spring-starter.md`.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
