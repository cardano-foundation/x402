# 090 — Bazaar declarations are built from typed config objects and returned as ordered maps

**Context.** TS `declareDiscoveryExtension` takes one loosely typed object and returns plain JSON. Java route `extensions` are `Map<String, Object>`, and the declaration must serialize with TS key order.

**Decision.** `HttpDiscoveryConfig` (query or body, chosen by `bodyType`) and `McpDiscoveryConfig` are fluent config classes; `Bazaar.declareDiscoveryExtension(config)` returns `{"bazaar": declaration}` as nested `LinkedHashMap`s, ready to merge into `RouteConfig.extensions`. JSON schemas and examples stay `Map<String, Object>`. The `bodyType` setter rejects values outside `json | form-data | text`.

**Alternatives.** One map-in map-out function mirroring TS (no compile-time help for Spring users); a full record model of the declaration (large, and the enrich step must pass unknown fields through anyway).

**Consequences.** Output is the same JSON as TS, byte for byte, which the vector test checks. Schemas are not validated.

**Reverse.** Add a map-based overload; nothing else depends on the config classes.
