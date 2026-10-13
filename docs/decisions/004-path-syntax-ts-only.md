# 004 — `path:` keeps the TS pattern syntax only

**Context.** YAML `path:` routes use the TS pattern syntax (`*`, `:id`, `[id]`) and reject Spring's `{id}`. I offered to also accept the controller's own mapping string, matched through Spring's handler lookup. The user did not answer.

**Decision.** TS syntax only, as planned. Same route strings work in every SDK and the e2e catalog; one matcher to keep at parity (`RoutePatternParityTest`). The `{`/`}` startup error message points to `:id` / `*`.

**Alternatives.** Accept `"GET /items/{id}"` and match it against the handler's declared pattern (no second syntax for Spring users, but a second code path).

**Reverse.** Additive: a later change can accept `{id}` without breaking existing YAML.
