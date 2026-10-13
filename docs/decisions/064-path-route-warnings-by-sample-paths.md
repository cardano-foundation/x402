# 064 — "Path matches no handler" and overlap use sample paths

**Context.** Rule 4: a `path:` matching no registered handler warns; an annotation/path overlap is logged once. Spring patterns (`/report/{id}`, `/**`) and TS patterns (`/report/*`) cannot be compared directly.

**Decision.** Each Spring pattern is turned into a concrete sample path (`{*x}`/`**` → `x/y`, `{x}`/`*`/`?` → `x`), normalized with TS `normalizePath` and matched by the TS pattern for each of the mapping's methods (any method when none). No match over all mappings → warning; a match on an annotated handler → one overlap warning per (path offer, annotated offer) pair. At runtime the annotation always wins.

**Alternatives.** Pattern-algebra intersection (complex); no check.

**Consequences.** Heuristic: a regex-constrained variable (`{id:\d+}`) or a functional/static-resource handler may produce a false "matches no handler" warning. Only a warning.

**Reverse.** Local to `OfferRegistry.checkPath`.
