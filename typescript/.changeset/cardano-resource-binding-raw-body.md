---
"@x402/core": patch
"@x402/express": patch
"@x402/fastify": patch
"@x402/hono": patch
"@x402/next": patch
---

Resource-bound payloads and raw request/response passthrough for schemes that need them.

- `PaymentPayloadContext.resource` lets a client scheme bind a payload to the resource it was quoted for; a server scheme opts in with `requireMatchingPayloadResource` and the HTTP layer rejects a mismatching client-carried resource. `afterVerify` aborts may select the HTTP status via `httpStatus`.
- `HTTPAdapter.getRawBody()` (implemented by the hono and next adapters) exposes the exact request bytes for schemes that verify signatures over the body.
- Skip-handler replays may return the original status, headers and raw body; every adapter forwards the handler's status to settlement as `responseStatus`.
