# 135 — Facilitator vectors record the TS client's outcome, not only its requests

**Context.** WP12: `export-facilitator.ts` starts a capture server, drives the TS `HTTPFacilitatorClient` against it and records the exact request bodies. The response expectations come from the plan's table.

**Decision.** The vectors are one file, `java/x402-core/src/test/resources/vectors/facilitator/http-facilitator-client.json`, with 11 cases. Each case records three things:
- the request: method, path, content type and exact body
- the table response the capture server served
- the TS client's outcome: its parsed result, or the error's name and message

The client runs against the base `/x402/`, with a trailing slash, as users write it.

- `settle-abort` serves the Java abort body and shows the **real** TS `settleResponseSchema` accepting it. `settle-abort-ts-e2e-shape` serves the TS e2e abort body and shows TS rejecting it. The Java port of the schema must agree with both (`theSchemaPortAgreesWithTsOnEveryCapturedSettleAnswer`).
- The Java tests assert that the handler answers each served body byte for byte, and that `HttpFacilitatorClient` sends the same request bytes as the TS client.
- The error cases record TS's messages (`Facilitator verify failed (500): {"error":"boom"}`), which `LocalFacilitatorClient` must reproduce.
- Only this exporter was run. `npm run export` now also runs it (`export:facilitator`).

**Alternatives.** Record requests only (the WP minimum). The claim that TS accepts the abort body would then rest on the Java port alone.

**Reverse.** n/a (test data).

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
