# 029 — Hook exceptions: resource server warns, facilitator and client propagate (TS)

**Context.** TS wraps every resource-server hook call in try/catch with `console.warn` (`x402ResourceServer.ts:1027-1046` and siblings), but the facilitator (`x402Facilitator.ts`) and client (`x402Client.ts`) call hooks without catching.

**Decision.** Mirror TS exactly. `X402ResourceServer` logs a warning and continues for throwing before/after/failure/cancel hooks and enrichment hooks. `X402Facilitator` and `X402Client` let hook exceptions propagate. A facilitator verify recovery from a thrown error returns without after-verify hooks; a recovery of an `isValid:false` verdict runs them (TS `:353-360`). `X402Facilitator` allows registration at any time (TS has no `initialize`); the resource server freezes registration at the first `sync()`/`initialize()` (WP3).

**Alternatives.** Uniform "warn and continue" everywhere (friendlier, but diverges from TS and could hide a deliberate abort by exception).

**Reverse.** Wrap the facilitator/client hook calls.
