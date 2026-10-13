# 035 — `HttpFacilitatorClient` transport details

**Context.** TS uses `fetch` with `AbortSignal.timeout`, zod schemas, and `createAuthHeaders()` returning `{verify, settle, supported, bazaar}`.

**Decision.**
- The whole exchange (headers and body) is bounded: `sendAsync(...).get(timeout)`, plus the request timeout. Verify uses `verifyTimeout` (15 s), settle and each `/supported` attempt use `timeout` (90 s).
- The default `HttpClient` follows redirects (`Redirect.NORMAL`, TS `redirect: "follow"`); callers may pass their own client (proxy, TLS).
- Response validation mirrors the zod schemas field by field (required `isValid` / `success` + `transaction` + `network`; optional strings and objects may be `null`; `/supported` defaults `extensions` to `[]` and `signers` to `{}`). Unknown fields are dropped, as zod does.
- `Retry-After` accepts delta-seconds and RFC 1123 dates (TS `Date.parse` accepts more formats); the delay is capped at 30 s and falls back to 1 s × 2^attempt. Sleeping and the clock are injectable for tests.
- `FacilitatorAuthProvider.AuthHeaders(verify, settle, supported)` is typed, so TS's flat-object misuse check is unnecessary; there is no `bazaar` entry (no Java discovery client).
- The `EXTENSION-RESPONSES` header is decoded into `extensionResponses` and logged with TS's field allowlist.

**Reverse.** Local to `HttpFacilitatorClient`.
