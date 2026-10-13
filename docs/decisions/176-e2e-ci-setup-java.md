# 176 — `e2e_tests.yml`: setup-java next to the Go and uv toolchains

**Context.** WP10: add `actions/setup-java` (temurin 17, maven cache) before `./setup.sh`, pinned by commit SHA, with no new secrets.

**Decision.**
- The step goes after "Install Python" and before "Install and build TypeScript SDK".
- It is gated on `steps.families.outputs.configured == 'true'`, like the Go and uv steps.
- It uses `actions/setup-java@c1e323688fd81a25caa38c78aa6df2d33d3e20d9 # v4.8.0`, the same pin as `.github/workflows/java.yml`, with `java-version: "17"`, `distribution: temurin`, `cache: maven`.
- No secret lines are added to the `.env` step.

**Alternatives.**
- An ungated step: wasted time on runs that skip e2e.
- A separate `actions/cache` for `~/.m2`, as `java.yml` does: `setup-java`'s built-in cache does the same with less YAML.

**Consequences.**
- CI's `.env` step writes no `SERVER_CARDANO_SELLER_MNEMONIC`, so `scripts/ci-select-families.sh` never selects `cardano`. Java components are built in CI (`setup.sh` builds every component) but not exercised until that secret line and the secret exist. Reported, not worked around (WP10 rule).
- A Java reactor compile failure fails "Setup E2E components" for every family (decision 171).

**Reverse.** Delete the step.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
