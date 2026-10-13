# 009 — `java/tools/ts-vectors` runs with the TS workspace's `tsx`

**Context.** The Java tests compare against fixtures exported from the TS reference SDK. The plan required the exporter not to edit TypeScript.

**Decision.** The exporter scripts import TS sources (and the cardano test helpers) by relative path and run with `typescript/node_modules/.bin/tsx` (or the cardano package's). No `node_modules` and no lockfile under `java/`. Generated fixtures are committed under each module's `src/test/resources/vectors/`, so the Java build never needs Node.

**Alternatives.** A separate pnpm workspace member (adds a package to the TS workspace, i.e. edits TS config); a vitest test inside the TS package (edits TS).

**Consequences.** Regenerating fixtures requires `pnpm install` in `typescript/` first.

**Reverse.** Move the scripts into a workspace package.
