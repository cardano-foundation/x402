# 132 — Facilitator handler: request validation, paths and fallbacks

**Context.** The plan's wire table (Roles §3) fixes 200/400/500 for verify and settle and 200 for supported. It leaves open what counts as "missing", what a malformed body gets, and how paths are matched. The TS e2e handler (`e2e/facilitators/typescript/index.ts:1039-1131`) answers 400 only for a falsy `paymentPayload` or `paymentRequirements`, and `express.json()` answers 400 to malformed JSON. Anything else reaches the facilitator.

**Decision.**
- 400 `{"error":"Missing x402Version, paymentPayload or paymentRequirements"}` when any of the three fields is absent or `null`, or when the body is empty. TS, Go and Python clients always send all three.
- 400 is also the answer to the following. This is a Java choice, stricter than the TS e2e handler, which answers 500.
  - malformed JSON
  - a body that is not a JSON object
  - an `x402Version` that is not an integer
  - a `paymentPayload` or `paymentRequirements` that is not an object or does not convert to its record (e.g. `maxTimeoutSeconds: "soon"`)

  The messages name the field, not Jackson internals.
- The top-level `x402Version` is checked for presence and type only. Routing uses `paymentPayload.x402Version`, as `X402Facilitator` does (TS).
- Paths are relative to the base path passed to the constructor:
  - `null`, `""` and `"/"` mean the root; a missing leading slash is added and trailing slashes are removed.
  - On the request path, a query string and trailing slashes are ignored, matching Express's default non-strict routing.
  - Any other path gets 404 `{error}`. A wrong method on a known endpoint gets 405 `{error}`; methods are compared case-insensitively.
- The abort body's `network` is `paymentRequirements.network`. When that is absent it is `""`, so the body still passes TS `settleResponseSchema` (the TS e2e uses `"unknown"`).
- The 500 `error` is the exception message, or the exception's class name when there is no message. TS uses `"Unknown error"` only for throws that are not an `Error`.

**Alternatives.** Mirror the TS e2e exactly and answer 500 for wrong types. The same clients would get worse diagnostics.

**Reverse.** Relax `PaidRequest.parse` in `FacilitatorHttpHandler`.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
