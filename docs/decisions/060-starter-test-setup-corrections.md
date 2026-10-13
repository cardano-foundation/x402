# 060 — Three starter test setup defects corrected after red-first

**Context.** Decision 001 makes tests immutable once red-first is logged. While WP5 went green, three test *setups* (not assertions) turned out to be wrong:
1. `X402PropertiesBindingTest` added the fake environment as a `SystemEnvironmentPropertySource` named `test-env`. Spring Boot applies env-var name mapping (`X402_ROUTES_REPORT_ACCEPTS_0_PRICE` → `x402.routes.report.accepts[0].price`) only to sources named `systemEnvironment` or `*-systemEnvironment`, so the env var was never seen and the test could not exercise the rule.
2. `StartupSyncTest.noOffersSkipsTheSync` removed all routes but kept the app with `@X402Payment("a")` handlers, which rule 1 (unknown offer) correctly rejects.
3. `ContractApp` was a `@Configuration`; Spring registers nested `@Component` member classes of configuration classes, so the variant-only `UnknownOfferController` was loaded in every contract app.

**Decision.** (1) Rename the source `test-systemEnvironment`. (2) Start the no-offers case with a `NoOffersApp` without annotated handlers. (3) Make `ContractApp` an `ImportSelector` that imports its beans and the two shared controllers explicitly. No assertion changed; each test now exercises what it states. Precedent: decision 054.

**Alternatives.** Change the assertions (would weaken the tests); move classes out of `ContractApp` (the contract references `ContractApp.UnknownOfferController`).

**Consequences.** None for production code.

**Reverse.** Revert the three setup edits; the tests then fail for setup reasons.
