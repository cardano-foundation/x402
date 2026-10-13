# 096 — Route validation: wire-form `extra`, used-kind capability checks, retryable classification

**Context.** Review findings S1 and S2.
- S1: the overlap check compared the declared `extra`, but requirements are matched in wire form, and `applyWireExtra` drops `assetTransferMethod: "default"`. Options `{assetTransferMethod:"default"}` pinned to A and `{assetTransferMethod:"script"}` pinned to B looked disjoint; on the wire the first has `{}`, a subset of anything, so a payment for B's option matched A's.
- S2: the HTTP layer added every core-level capability problem (owner's kind) as a fatal error, even for kinds whose every option is pinned to another facilitator. Capability and ambiguity errors were always non-retryable, even when a failed facilitator caused them.

**Decision.**
- The overlap check compares `applyWireExtra(price.extra ← option.extra, resolve(...))` minus dynamic fields.
- Core-level problems (`X402ResourceServer.facilitatorCapabilityProblems`, new structured accessor) are added only for registered kinds that **no option uses**; those stay fatal and routeless (TS parity, `RouteValidationTest#aCapabilityProblemOfAnUnusedSchemeIsStillFatal`). Kinds options use are checked per option with that option's build facilitator. This is narrower than the reviewer's wording ("skip kinds no option uses with that owner as build facilitator"), which would also drop the unused-kind check that an existing immutable test requires. It fixes the reported case (all options pinned elsewhere).
- A per-option `facilitator_capability` error, and an `ambiguous_options` error, are `retryable` when some facilitator failed and the option (for ambiguity: either option) is unpinned or its pin is the one that failed.

Tests: `RouteValidationReviewTest` (S1, both S2 cases).

**Reverse.** Restore the declared-extra comparison and the unconditional core-level loop in `publishValidated`.
