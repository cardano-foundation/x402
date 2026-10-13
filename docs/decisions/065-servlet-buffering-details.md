# 065 — Servlet buffering and failure-path details

**Context.** WP5 asks for an own buffering implementation following the WP4 adapter contract; several details were open.

**Decision.**
- `BufferingResponse` passes headers and `setStatus` through to the real response (never committed while buffering) and holds back the body, `sendError` and `sendRedirect`; they are replayed after the settle decision. `Content-Length` from the handler is ignored and recomputed.
- `Settlement-Overrides` set by the handler stays inside the wrapper: it is handed to `processSettlement` and never reaches the client (Tomcat ignores `setHeader(name, null)`, so it could not be removed afterwards).
- Settle failure keeps the handler's other headers and writes the failure response over them (TS express keeps `res.setHeader` values).
- A handler exception cancels (`handler_threw`), sets failure-path headers when there is a receipt, and is rethrown for Spring Boot's error handling (TS `next(err)`).
- An async request that ends without a final dispatch (e.g. the client went away) is cancelled by an `AsyncListener`; nothing is settled.
- `FacilitatorResponseException` → 502 `{"error": message}`; any other exception in `processHttpRequest` → 500 `{"error":"Internal Server Error"}`, logged (TS `sendFacilitatorError` / `sendInternalError`).
- `RouteUnavailable`: retryable → 503, `Retry-After: 5`, `{"error":"x402 facilitator unavailable"}`; else 500 `{"error":"x402 route configuration"}`.
- Non-blocking writes (`setWriteListener`) on a paid response throw; streaming is refused at startup anyway (rule 7).

**Reverse.** Each point is local to `BufferingResponse` / `X402ServletFilter`.

**Superseded in part by [144](144-paid-response-fully-buffered.md):** handler headers, status and cookies are now buffered too, and a failed settle no longer keeps them.
