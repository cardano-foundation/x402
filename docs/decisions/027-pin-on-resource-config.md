# 027 — The pin lives on core `ResourceConfig`; `PaymentOption` is an HTTP type

**Context.** WP3 says "`PaymentOption.facilitator` (optional name; never serialized)". In TS, `PaymentOption` (with dynamic `payTo`/`price` functions of the HTTP request context) is an HTTP-layer type; core only sees `ResourceConfig` per option.

**Decision.** Core `org.x402.core.server.ResourceConfig` (TS shape + `facilitator`) carries the pin into `buildPaymentRequirements`; `org.x402.http.PaymentOption` (WP4) carries `facilitator` plus static or dynamic `payTo`/`price` and resolves to a `ResourceConfig` per request. Neither type is serialized; requirements are built from scratch, so no pin reaches the wire (`FacilitatorPinningTest` asserts it).

**Alternatives.** A core `PaymentOption` with an untyped request context (TS's generic `TContext`), which loses typing for the dynamic functions.

**Consequences.** The WP3 text now says "the option's pin (`ResourceConfig.facilitator`; `PaymentOption.facilitator` in WP4)".

**Reverse.** Move `PaymentOption` into core with a generic context parameter.
