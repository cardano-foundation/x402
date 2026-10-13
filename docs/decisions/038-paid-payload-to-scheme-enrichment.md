# 038 — Paid-path 402s hand the payload to scheme enrichment (closes the gap in 049)

**Context.** Decision 049 (WP7) reports that the Masumi quote issuer needs the paid payload when a 402 is built for a paid request, to re-serve the stored quote the payment names. TS core passes `paymentPayload` only on some 402s; TS schemes read the payload from `transportContext.request.paymentHeader` on all of them. The Java `HttpTransportContext` has no `paymentHeader`, so without a change the Java issuer would issue a fresh quote and the payment would not match.

**Decision.** `X402HttpResourceServer.processHttpRequest` passes the decoded payload as `PaymentRequiredContext.paymentPayload` on every 402 it builds for a paid request (the first build, "No matching payment requirements", extension echo mismatch, invalid verify, verify errors). Unpaid requests pass `null`. This is the same information TS schemes get through the header. `PaidPathEnrichmentTest` pins it (red first, then fixed).

**Alternatives.** Add TS's `paymentHeader` to `HttpRequestContext` (the issuer would then depend on an HTTP type or a `Map` shape).

**Consequences.** A scheme that took "payload present" to mean "payment rejected" would see it earlier than in TS; the only Java consumer (the Masumi issuer) uses `payload ?? header` like TS.

**Reverse.** Pass `null` on the first build and add `paymentHeader` to the transport context.
