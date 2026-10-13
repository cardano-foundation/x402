# 049 — How the quote issuer finds the paid payload on a 402

**Context.** On a paid retry that ends in a 402, TS's issuer re-serves the stored quote the payload names. TS core does not pass the payload to `enrichPaymentRequiredResponse`; the issuer reads the `PAYMENT-SIGNATURE` header out of the HTTP transport context (`request.paymentHeader`) or MCP `meta`. The Java core context record has a `paymentPayload` field, but whether WP4 fills it, and what its transport context looks like, is not settled.

**Decision.** `MasumiQuoteIssuer.paidPayload` uses, in order: `context.paymentPayload()`; a `Map` transport context with `request.paymentHeader` (base64 JSON) or `meta["x402/payment"]`; the configurable `MasumiIssuerConfig.paymentPayloadFromTransport`.

**Alternatives.** Depend on a WP4 type (not stable yet; core is being changed concurrently).

**Consequences.** Update 2026-10-12: WP3/WP4 now fill `PaymentRequiredContext.paymentPayload` on paid-path 402s (orchestrator note), so the first source applies and the stored quote is re-served from it. The `Map` and hook fallbacks stay for transports that do not fill the field (TS parity: TS reads the transport). Without any source, a paid retry gets a fresh quote; no funds risk, as the terms binding refuses the old quote.

**Reverse.** Remove the Map fallback; core fills the field.
