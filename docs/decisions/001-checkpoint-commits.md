# 001 — No commits; staged changes and manual red-first

**Context.** The plan's execution model wanted one checkpoint commit per work package, so `~/.claude/bin/red-first.sh <base>` could prove each new test fails at the base. The user approved the plan and said to take the recommended path. The first checkpoint commit (plan docs) was **refused by the `git-authority` hook** (2026-10-12). The user's standing rule: a git-gate deny means stop and tell, never route around it.

**Decision.** No commits. All work stays as working-tree changes, staged at the end (`git add`), on `feat/java-v2-spring-starter`. Red-first is proven manually instead of with `red-first.sh`: each new test is written and run **before** its production code exists (compile failure or assertion failure), and the failing output is recorded in the work package's `## Log`. `check-scope.sh` is replaced by a review of `git status` against each package's allowed files.

**Alternatives.** Ask the user to run commits with `!` (forbidden by the "don't ask until done" instruction); `git commit-tree` to fake bases (that would be routing around the gate).

**Consequences.** One large staged change set. The red-first evidence is a log entry, not a reproducible script run.

**Reverse.** The user can commit per package afterwards; the work package files list each package's files.
