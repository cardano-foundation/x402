# 130 — Facilitator handler: which unknown JSON fields survive

**Context.** WP12 requires that unknown JSON fields survive the typed model (`JsonNode` fields or `@JsonAnySetter`), with no raw-byte passthrough. `FacilitatorHttpHandler` (core, `org.x402.http.facilitator`) must hand `X402Facilitator` the typed `PaymentPayload` / `PaymentRequirements` records. Those records mirror the TS types field for field. Their open parts are `Map<String, Object>` (`payload`, `extensions`, `extra`); their other fields are closed. The core types are outside this package's file ownership.

**Decision.**
- Unknown fields anywhere inside the open maps reach the scheme unchanged: `paymentPayload.payload`, `paymentPayload.extensions`, `paymentPayload.accepted.extra` and `paymentRequirements.extra`, at any depth. This is tested against the captured TS request, which carries such fields: `FacilitatorWireContractTest.theSchemeReceivesTheCapturedPayloadIncludingUnknownFields` checks deep equality between what the scheme received and what TS sent.
- Unknown **top-level** fields of the request body, of `paymentPayload`, of `paymentRequirements` and of `resource` are accepted (200, `unknownTopLevelFieldsAreAccepted`) and ignored. No test asserts that they are dropped, so adding an any-setter later breaks nothing.

**Why this is enough today.** Every Java scheme receives typed records, so it can only read a field outside the declared ones through an open map. TS puts all scheme- and extension-specific data in those maps. TS itself would pass a top-level unknown field through by reference, so this is a narrow divergence.

**Alternatives.**
- `@JsonAnySetter`/`@JsonAnyGetter` on `PaymentPayload`, `PaymentRequirements` and `ResourceInfo`. This is a core type change: it affects equality, `deepEqual`, header encoding and every vector test, and it needs core ownership and review.
- Passing raw `JsonNode` to the facilitator, which is an SPI change.

**Consequences.** If a future protocol version adds a top-level field, core needs a record field for it anyway, because schemes read typed values.

**Reverse.** Add any-setter maps to the three records in core. The handler needs no change.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking. Flagged in the report as a deviation from the literal WP wording.
