# 051 — The Cardano exporter runs with the workspace tsx

**Context.** Decision 009 allows the workspace `tsx` "or the cardano package's". The cardano package has no `tsx` binary of its own.

**Decision.** `npm run export:cardano` runs `typescript/node_modules/.bin/tsx`. The exporter resolves TS sources and their dependencies (`@evolution-sdk/evolution`, `lz-string`) through `createRequire` anchored at the cardano package, so module resolution is the package's own. No TS file is edited.

**Alternatives.** Add tsx to the cardano package (edits TS).

**Consequences.** Regenerating needs `pnpm install` in `typescript/` and Node 22+ (it loads ESM modules from CommonJS).

**Reverse.** Point the script at another tsx.
