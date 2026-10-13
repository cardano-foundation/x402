# 023 — Core logs through `System.Logger`

**Context.** Core must stay dependency-light (Jackson only) and Spring-free, yet TS logs warnings in several places (throwing hooks, failed `/supported`, failover, settle results).

**Decision.** Core uses `java.lang.System.Logger` (JDK platform logging). Without configuration it goes to `java.util.logging`; Spring Boot routes JUL to Logback via `jul-to-slf4j`, so starter users see the lines in their normal log. Levels: WARNING for TS `console.warn` sites, failover and sync failures; INFO for each settle (facilitator identifier, network, success), as the plan's observability rule asks; DEBUG for each verify.

**Alternatives.** SLF4J API dependency in core (one more dependency for non-Spring users); no logging (loses TS warnings).

**Consequences.** Non-Spring users configure JUL or install a `System.LoggerFinder`.

**Reverse.** Swap the logger field in the few classes that log.
