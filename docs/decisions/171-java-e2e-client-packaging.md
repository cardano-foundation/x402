# 171 — Java e2e client is a standalone Maven app run from a plain classpath

**Context.** The client must build from a clean checkout in CI (`setup.sh` → `build.sh`). It also has to start fast, because it runs as a one-shot process per scenario. It is not part of the `java/` reactor: the reactor's module list is frozen in WP1, and `java/**` is out of WP10's scope.

**Decision.**
- `e2e/clients/java/http/java-http/pom.xml` is standalone (`org.x402.e2e:java-http`). It imports `org.x402:x402-parent:2.0.0-SNAPSHOT` as a BOM, so it gets the same Jackson and cardano-client-lib versions as the SDK. It depends on `x402-core` and `x402-mechanism-cardano`.
- `build.sh` runs `mvn -q -f ../../../../../java/pom.xml install -DskipTests`, then `mvn -q package`. The path goes five levels up from the component directory; the brief's four-level path would point at `e2e/java`. `maven-dependency-plugin` copies the runtime jars to `target/lib`.
- `run.sh` runs `java -cp "target/java-http.jar:target/lib/*" org.x402.e2e.client.Main`. It does not build.
- `CARDANO_NETWORK` (injected by the harness) picks the network; the default is `cardano:preprod`. `CARDANO_RPC_URL` defaults to `BlockfrostChainBackend.defaultBaseUrl(network)`.
- `e2e/clients/java/.gitignore` ignores `target/`.

**Alternatives.**
- Shade or fat jar: BouncyCastle is a signed jar, so shading needs signature filtering.
- `spring-boot-maven-plugin` repackage: the client has no Spring.
- `mvn exec:java` in `run.sh`: Maven would start up for every scenario.

**Consequences.** Every `setup.sh` run, CI included, installs the Java reactor once. A reactor compile failure fails `setup.sh`, because it exits 1 on any failed component. A broken Go or Python component already does the same.

**Reverse.** Replace the component's `build.sh`, `run.sh` and `pom.xml`.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
