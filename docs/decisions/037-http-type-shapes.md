# 037 — Shapes of the HTTP-layer types

**Context.** WP4 names the types; their exact shape was open.

**Decision.**
- `HttpAdapter` keeps TS's getter names (`getHeader`, `getMethod`, `getPath`, `getUrl`, `getAcceptHeader`, `getUserAgent`); header lookup is case-insensitive by contract.
- `HttpRequestContext(adapter, method, path, decodedPath, routePattern)` is a record; headers and URL are read through the adapter (`header(name)`, `url()`).
- `RouteResolver` has `resolve(ctx) → RouteMatch(key, pattern, config)` and `routes()`; the key scopes validation errors (a pattern for `PatternRouteResolver`, an offer name for the Spring starter).
- `PaymentOption` holds a static `payTo`/`price` **or** a `DynamicPayTo`/`DynamicPrice` (exactly one of each; builder enforces it) plus the pin; `RouteConfig` is TS's route plus `failover`.
- `HttpProcessResult.PaymentError` wraps `HttpResponseInstructions(status, headers, body, html)` and exposes `status()/headers()/body()/html()`; an empty JSON body is `Map.of()`.
- `PaymentVerified` carries `routing` (`SettlementRouting`: route, `verifiedBy`, snapshot) and `routeKey`; `verifiedBy()` is a convenience accessor.
- `ProtectedRequestHook.Result` is sealed (`proceed`, `grantAccess`, `abort(reason)`); extensions add one through `HttpResourceServerExtension.onProtectedRequest` (TS `transportHooks.http`).

**Reverse.** Additive changes only from here on (WP5/WP6 depend on these shapes).
