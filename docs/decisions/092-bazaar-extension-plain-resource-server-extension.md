# 092 — The bazaar server extension implements only `ResourceServerExtension`

**Context.** TS `bazaarResourceServerExtension` has `key` and `enrichDeclaration` only, with no transport hooks. Core calls `enrichDeclaration(declaration, transportContext)` with whatever the transport supplies.

**Decision.** `BazaarServerExtension implements ResourceServerExtension` (not `HttpResourceServerExtension`). It enriches only when the context is an `HttpRequestContext` and the declaration is a map; otherwise it returns the declaration unchanged. It never mutates its input: every map it edits is copied.

**Alternatives.** Extending `HttpResourceServerExtension` for a hook it would not use.

**Consequences.** Safe to share one instance across requests. Route patterns follow TS: `[param]` and `:param` become a `:param` template, `*` segments become `:var1`, `:var2`, a bare `*` yields no template, and a non-matching path gives empty `pathParams`.

**Reverse.** Switch the interface; behaviour is unchanged.
