# 104 — The client scheme passes no resource to the signer (TS parity); registry claims are therefore refused client-side

**Context.** TS `exact/client/scheme.ts:86-93` calls the signer with `{network, payTo, asset, amount, maxTimeoutSeconds, extra}`. `resource` is an optional field of the signer input (`signer.ts:231`), and the scheme never sets it. Its comment says registry claims are validated by the facilitator against `PaymentPayload.resource`. `MasumiVerifier.verifyAuthorization` refuses a non-empty `agentIdentifier` without both a validator and a resource.

**Decision.** Mirror TS. `ClientCardanoSignInput.resource` exists, so a direct caller of the signer can pass one, but `ExactCardanoClientScheme` passes `null`. Through the scheme, a 402 that claims a registered agent is refused before the wallet is touched, as in TS. Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking; flagged for user sign-off in the final report.

**Alternatives.** Thread core's resource into the signer (core's `PaymentPayloadContext` has no resource field; that would be a core change, which is out of scope).

**Consequences.** Buyers paying registered Masumi agents through the scheme need a later core/TS change; they can call the signer directly meanwhile.

**Reverse.** Pass the resource once core exposes it.
