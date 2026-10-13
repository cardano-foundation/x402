# 192 — Java e2e Spring apps: Boot parent, `target/app.jar`, reactor install in `build.sh`

**Context.** The two servers and the facilitator are Spring Boot apps outside the `java/` reactor. Like the client (decision 171), they must build from a clean checkout through `setup.sh`.

**Decision.**
- Each `pom.xml` uses `spring-boot-starter-parent` 3.5.16, the SDK's Boot version and the same layout as `examples/java/*`. It depends on `org.x402:x402-spring-boot-starter:2.0.0-SNAPSHOT` plus `spring-boot-starter-web` (MVC, facilitator) or `-webflux`.
- `spring-boot-maven-plugin` packages `target/app.jar`. `run.sh` is `exec java -jar target/app.jar`.
- `build.sh` runs `mvn -q -f <repo>/java/pom.xml install -DskipTests`, then `mvn -q package -DskipTests`. The reactor path is `../../../../../java/pom.xml` from the servers and `../../../java/pom.xml` from `facilitators/java`.
- `e2e/servers/java/.gitignore` and `e2e/facilitators/java/.gitignore` ignore `target/`.

**Evidence.** `./setup.sh` sets up 19/19 components with 0 failures, including `server/java/http/spring-mvc`, `server/java/http/spring-webflux`, `client/java/http/java-http` and `facilitator/java`. No tracked files changed.

**Consequences.** `setup.sh` installs the reactor four times, once per Java component. The runs after the first are incremental (a few seconds locally). In CI the first one compiles everything.

**Reverse.** Replace the poms and scripts.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
