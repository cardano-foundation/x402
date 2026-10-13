# 175 — Local e2e environment prep: rebuilt TS SDK dists, restored `e2e/pnpm-lock.yaml`

**Context.** Two local-environment problems came up while running e2e for WP10. Neither involves a source change.
1. The TypeScript SDK `dist/` folders were from April 2026, older than the sources. The TS e2e facilitator failed to start: it could not find `@x402/evm/dist/esm/auth-capture/facilitator/index.mjs`.
2. Every `pnpm` command in `e2e/` (`pnpm test`, `pnpm exec`) ran pnpm 11's automatic install first. That install rewrote `e2e/pnpm-lock.yaml`: it pruned the stale `facilitators/external-proxies/cdp*` importers, whose directories do not exist in the repo, about 800 lines. `e2e/pnpm-lock.yaml` is not a WP10 file.

**Decision.**
1. Rebuild the TS SDK the way CI does (`pnpm build` in `typescript/`), but call `./node_modules/.bin/turbo run build` directly. This skips pnpm's automatic install, so neither lockfile nor `node_modules` link is touched. Only gitignored `dist/` output changed.
2. After the runs, restore `e2e/pnpm-lock.yaml` to its HEAD content with a plain file write (`git show HEAD:e2e/pnpm-lock.yaml > e2e/pnpm-lock.yaml`). This is not a git write (decision 001).

**Alternatives.** Leave the lockfile rewrite in the change set: unrelated churn in a file nobody owns.

**Consequences.** Anyone who runs `pnpm` in `e2e/` gets the same lockfile rewrite. It already happens on HEAD and is not caused by WP10. A follow-up could commit the pruned lockfile deliberately.

**Reverse.** n/a.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
