# 151 — Bazaar declarations from YAML; Spring patterns reach hooks in x402 syntax

**Context.** WP9b maps `x402.routes.<offer>.extensions.bazaar` to the WP9a declaration. The plan only shows `{ discoverable: true }`. The bazaar server extension derives `routeTemplate` and `pathParams` from the hook's `routePattern`, in x402 syntax (`:param`, `[param]`, `*`). For annotated handlers, the filters passed Spring's pattern (`/weather/{city}`).

**Decision.**
- `BazaarDeclarations` (an `X402RouteCustomizer`) reads these keys, with kebab-case and camelCase both accepted:
  - `discoverable`: `false` omits the extension;
  - `method`, `input`, `input-schema`, `path-params`, `path-params-schema`;
  - `body-type` (`json`, `form-data`, `text` makes it a body declaration);
  - `output.{example, schema}`.

  A scalar `bazaar: true` declares the defaults. Unknown keys, a wrong `body-type`, or a non-object `input` fail startup naming the offer. Spring's index-keyed maps are restored to lists. Scalar values stay strings (YAML binding), so numeric examples arrive as text.
- `X402BazaarAutoConfiguration` registers `BazaarServerExtension` once (unless a customizer already did), so the method enum is narrowed to the dispatched mapping's method per request.
- Both filters convert the best-matching Spring pattern before handing it to hooks: `{name}` → `:name`, `{*name}` and `**` → `*` (`OfferRegistry.toRoutePattern`). `path:` offers already use x402 syntax.

**Alternatives.** Typed bazaar properties (would force a schema for free-form JSON schemas); passing Spring patterns through (no `routeTemplate` for annotated routes).

**Reverse.** Remove the customizer; drop the pattern conversion.
