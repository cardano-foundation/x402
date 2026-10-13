# WP-1: v1 lives in java/legacy and still passes; every v2 module skeleton builds green; CI runs both
Tier: R1
Base: f8f83309
Check: legacy exactly as its CI job runs it — `mvn clean test -Pcoverage`, `mvn checkstyle:check`, `mvn spotbugs:check` in `java/legacy` (42 tests; decision 008) and `mvn -B -f java/pom.xml verify checkstyle:check spotbugs:check` both exit 0; java.yml has a legacy and a v2 job

## Allowed files
- java/**
- .github/workflows/java.yml
- docs/**

## Rules
- Move v1 into `java/legacy/` with history-preserving renames: pom, src, checkstyle/spotbugs configs, README. Zero source edits. Legacy keeps `org.x402:x402:1.0.0-SNAPSHOT` and stays outside the reactor, as `go/legacy` is a separate module.
- New `java/pom.xml`: `org.x402:x402-parent:2.0.0-SNAPSHOT`, packaging pom, `maven.compiler.release` 17.
  - dependencyManagement: jackson 2.17.x, junit 5.10, mockito, assertj, archunit, wiremock, reactor BlockHound, spring-boot-dependencies 3.5.x (import), cardano-client-lib + backend-blockfrost + cip8 0.7.x.
  - pluginManagement: copy v1's checkstyle/spotbugs/jacoco gates (`coverage` profile: instruction ≥ 0.85, branch ≥ 0.75). Surefire argLine `@{argLine} -XX:+AllowRedefinitionToAddDeleteMethods`, for BlockHound with jacoco. Define an empty `<argLine/>` property in the parent so `@{argLine}` resolves when jacoco's prepare-agent is not bound (plain `test` runs and red-first).
- **Skeletons for every v2 module:** `x402-core`, `x402-mechanism-cardano`, `x402-extensions`, `x402-spring-boot-autoconfigure`, `x402-spring-boot-starter`. Each has a pom with its final inter-module dependencies, an empty main package, and one passing `SmokeTest`. The `<modules>` list is frozen after this package.
- `java/tools/ts-vectors/`: an empty Node project skeleton (package.json referencing workspace `@x402/core` and `@x402/cardano` via relative paths, plus a README). Filled by WP2 and WP7.
- Delete the stale untracked `java/target/`.
- java.yml: job `legacy` (existing commands, working-directory `java/legacy`) and job `v2` (`mvn -B verify -Pcoverage checkstyle:check spotbugs:check` in `java/`). Paths filter stays `java/**`.
- Checkpoint commit at the end, if the user approved the Execution model; it includes `docs/plans` and `docs/work`.
- Out of scope: any v2 production code.

## Proof commands
- red-first: no new tests (move + skeletons)
- green: the two Check commands
- scope: ~/.claude/bin/check-scope.sh docs/work/wp-1-legacy-move-and-reactor.md
- rename check: `git diff -M --stat f8f83309 -- java/legacy/src` shows only 100 % renames

## Log
- 2026-10-12: baseline before the move: v1 `verify -Pcoverage` fails its own jacoco check (it never ran in CI, which uses `test -Pcoverage`); the CI command sequence is green with 42 tests. Legacy check switched to the CI sequence (decision 008).
- Moved with `mv` (git gate blocks `git mv`); staged: 28 files are R100 renames, legacy content byte-identical.
- v2 reactor: parent `org.x402:x402-parent:2.0.0-SNAPSHOT`, Spring Boot 3.5.16, cardano-client-lib 0.7.2 (same as `cardano-x402-facilitator`), jackson/junit/mockito/assertj/reactor via the Boot BOM. Shared lint config in `java/config/` (v1 rules copied unchanged; checkstyle severity stays `warning` as in v1). Starter bundles Cardano + extensions (decision 007). `ts-vectors` runs with the TS workspace's tsx (decision 009).
- Green: `mvn -B verify -Pcoverage checkstyle:check spotbugs:check` in `java/` → BUILD SUCCESS, 5 smoke tests; legacy CI sequence → exit 0, 42 tests.
- red-first: none (no new behaviour). Scope: all changes under `java/**`, `.github/workflows/java.yml`, `docs/**`.
