# 180 — Two client examples: `clients/java-http` and `clients/spring-rest-client`

**Context.** WP11 asks `clients/java-http` to show both a plain `X402HttpClient` and an `@HttpExchange` interface with spend controls. The orchestrator's brief names "java-http plain X402HttpClient and a Spring RestClient example". An `@HttpExchange` interface needs Spring, the starter and a Spring Boot application; the plain example's point is that it needs none of that.

**Decision.** Two standalone Maven modules:
- `examples/java/clients/java-http`: plain Java, `x402-core` + `x402-mechanism-cardano`, `X402HttpClient` with a `HostPolicy`, spend controls allowing lovelace up to 2 ADA, an optional ADA-preferring policy (`PAY_WITH=ada`).
- `examples/java/clients/spring-rest-client`: Spring Boot command-line app, `x402.client.*` from YAML, an `@HttpExchange` interface on Boot's `RestClient.Builder`, and a self-built `RestClient` using `x402Decorator.decorate(factory, nonRedirectingFactory)`.

Both have tests against WireMock with a recording scheme in place of the wallet. The WP11 green command gains one `mvn -f examples/java/clients/spring-rest-client/pom.xml verify`.

**Alternatives.** One `java-http` module containing a Spring Boot app as well (the plain example would carry Spring on its classpath, and "no Spring" would no longer be visibly true).

**Consequences.** Four example modules instead of three. The plan's change map lists the new module (decision 185).

**Reverse.** Move the Spring classes into `java-http` and merge the poms.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
