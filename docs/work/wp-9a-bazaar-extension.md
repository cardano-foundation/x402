# WP-9a: the bazaar extension module produces declarations identical to TS
Tier: R1
Base: <git rev-parse HEAD at package start>
Check: `BazaarDeclarationTest` — output equals the vector exported from TS bazaar for the e2e paid route (cf. `e2e/servers/go/routes.go:45`)

## Allowed files
- java/x402-extensions/**
- java/tools/ts-vectors/**
- docs/**

## Rules
- Can start after WP3.
- Port `DeclareDiscoveryExtension(method, input, output, …)` and the server extension (key `bazaar`) only. No client or facilitator discovery.
- Add the bazaar declaration to the exporter as a new fixture file (`export-bazaar.ts`). Existing vector files are untouched.

## Proof commands
- red-first: ~/.claude/bin/red-first.sh <Base> --setup 'mvn -q -f java/pom.xml install -DskipTests' java/x402-extensions/src/test/java/org/x402/extensions/bazaar/BazaarDeclarationTest.java -- mvn -f java/pom.xml -pl x402-extensions test
- green: `mvn -B -f java/pom.xml -pl x402-extensions verify -Pcoverage checkstyle:check spotbugs:check`
- scope: ~/.claude/bin/check-scope.sh docs/work/wp-9a-bazaar-extension.md

## Log
- red-first (manual, decision 001): `BazaarDeclarationTest` written first; `mvn -B -q -pl x402-extensions test` failed with compile errors (`cannot find symbol: Bazaar, HttpDiscoveryConfig, McpDiscoveryConfig`). Test unchanged afterwards.
- Added `java/tools/ts-vectors/export-bazaar.ts` and script `export:bazaar` in its `package.json`; ran it: `wrote bazaar.json (12 declare, 14 enrich)` -> `java/x402-extensions/src/test/resources/vectors/bazaar.json`.
- Added `org.x402.extensions.bazaar`: `Bazaar` (declareDiscoveryExtension, KEY), `HttpDiscoveryConfig`, `McpDiscoveryConfig`, `DiscoveryOutput`, `BazaarServerExtension` (key `bazaar`, enrichDeclaration), `package-info`.
- Added test `java/x402-extensions/src/test/java/org/x402/extensions/bazaar/BazaarDeclarationTest.java` (30 tests: 12 declare vectors, 14 enrich vectors, 4 unit).
- Decisions 090-094 written and indexed in `docs/decisions/README.md`.
- green: `cd java && mvn -B -pl x402-extensions verify -Pcoverage checkstyle:check spotbugs:check` exit 0:
  `Tests run: 31, Failures: 0, Errors: 0, Skipped: 0` / `All coverage checks have been met.` / `BUILD SUCCESS`
- Ran from `java/` per the task rather than the WP's `-f java/pom.xml` form.
- Core API gap: none. `X402ResourceServer` passes the transport context to `enrichDeclaration`; the extension relies on it being an `HttpRequestContext` (not verified against the core HTTP layer's actual argument).
