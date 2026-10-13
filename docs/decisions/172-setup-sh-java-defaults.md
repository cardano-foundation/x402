# 172 — `setup.sh`: `pom.xml` counts as setup work and gets a default `mvn -q package`

**Context.** WP10 rules: add `java` to the `setup.sh` language case and to `has_setup_work`. `has_setup_work` already matches any `build.sh`, and every Java component ships one.

**Decision.**
- `java` joins the `process_role_v2` language case.
- `has_setup_work` also matches `pom.xml`.
- `default_build` runs `mvn -q package` for a component that has a `pom.xml` and no `build.sh`. This mirrors the Go (`go build`) and Python (`uv sync`) defaults. When `build.sh` is present, it still wins.

**Alternatives.**
- Only the language case: a component with just a `pom.xml` would be skipped silently.
- Match `pom.xml` without a default build: the component would be counted as set up with nothing run.

**Consequences.** No change for existing components. After the change, `./setup.sh` set up all 16 components (the 15 existing ones plus `client/java/http/java-http`) with 0 failures and no tracked Go or Python file changes.

**Reverse.** Drop the `pom.xml` clauses in `e2e/setup.sh`.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
