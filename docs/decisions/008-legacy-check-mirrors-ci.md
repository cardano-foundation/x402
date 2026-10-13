# 008 — Legacy check mirrors the existing CI commands

**Context.** WP1 said the moved v1 module must pass `mvn verify -Pcoverage checkstyle:check spotbugs:check`. At the base commit that command already fails: v1's jacoco `check` (bound to `verify`) misses its coverage minimum. CI never noticed because it runs `mvn clean test -Pcoverage`, `mvn checkstyle:check` and `mvn spotbugs:check`, so `verify` is never reached.

**Decision.** The legacy job and the WP1 check run exactly the old CI sequence in `java/legacy`. Zero source edits to v1 (the move is pure renames).

**Alternatives.** Raise v1 coverage (edits legacy code, out of scope); lower its threshold (edits legacy config).

**Consequences.** Legacy stays exactly as gated as before the move. The v2 job uses `verify -Pcoverage`, where the gate is real.

**Reverse.** Change the legacy job's commands.
