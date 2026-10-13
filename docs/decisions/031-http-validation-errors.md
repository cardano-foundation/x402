# 031 — HTTP route validation reports every problem as a classified `RouteValidationError`

**Context.** Plan Roles §1b says a pinned facilitator lacking the kind or capability is a "fatal `FacilitatorCapabilityError` naming it", while WP4 says `X402HttpResourceServer.initialize()` throws `RouteConfigurationError` listing every error, classified per route, with enough information for WP5's partial-outage rule (start and answer 503 on affected routes when only a failed facilitator could fix the problem).

**Decision.**
- `initialize()` collects all problems as `RouteValidationError(route, scheme, network, reason, message, optionIndex, facilitator, retryable)`. Reasons: TS's `missing_scheme`, `missing_facilitator`, `unsupported_asset_transfer_method`, `unsupported_payment_flow`, plus Java's `unknown_facilitator`, `facilitator_capability`, `ambiguous_options`. TS messages are kept verbatim where TS has the check.
- Pinned-facilitator problems are reported here (`missing_facilitator` / `facilitator_capability`, naming the facilitator and option index) inside a `RouteConfigurationError`, not as a separate `FacilitatorCapabilityError`; both are fatal under `isFatalStartupError`. Core `X402ResourceServer.initialize()` still throws `FacilitatorCapabilityError` for direct core users (TS parity).
- Capability problems of registered schemes no route uses come from core's TS check and are reported with `route = null`.
- `retryable` = a `missing_facilitator` error that a failed facilitator could heal (unpinned: any facilitator failed; pinned: that facilitator failed). `RouteConfigurationError.onlyAwaitingFacilitators()` is true when all errors are retryable.
- `isFatalStartupError` stays TS-exact (`FacilitatorCapabilityError` or `RouteConfigurationError`); WP5 applies the Java partial-outage refinement with `onlyAwaitingFacilitators()`.
- Order: the new `HttpServerState` is always published first; then non-retryable errors → `RouteConfigurationError`; else no kinds at all → `IllegalStateException` (TS's retryable "no supported payment kinds"); else retryable errors → `RouteConfigurationError`.

**Alternatives.** Throw `FacilitatorCapabilityError` for pin problems (two exception types to merge in WP5, and the per-route classification would be lost).

**Consequences.** The plan's §1b wording is updated to "fatal startup error (`RouteConfigurationError` entry naming it)".

**Reverse.** Split pin/capability entries into a `FacilitatorCapabilityError` thrown before the route errors.
