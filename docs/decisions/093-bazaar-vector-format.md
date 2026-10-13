# 093 — Bazaar vectors: declare and enrich cases in one file, compared as exact JSON text

**Context.** Existing exporters write `{generatedFrom, tsCommit, cases}`. Bazaar has two behaviours, and key order is part of what a catalog consumer sees.

**Decision.** `export-bazaar.ts` writes `vectors/bazaar.json` with `kind: "declare"` cases (TS config in, declaration out) and `kind: "enrich"` cases (declaration plus `{method, path, routePattern}` in, enriched declaration out, or a non-HTTP context). The e2e paid route, a POST/body route, path-param schemas, falsy examples and the MCP shapes are included. The Java test serializes both sides compactly and compares the text, so key order must match. TS sources load with `createRequire` and the workspace `tsx`, as in decisions 009 and 051. `export:bazaar` is added to `package.json`; the aggregate `export` script is left alone.

**Alternatives.** Order-insensitive tree comparison.

**Consequences.** Re-running the exporter on a newer TS commit shows any drift as a test failure.

**Reverse.** Compare trees instead of text.
