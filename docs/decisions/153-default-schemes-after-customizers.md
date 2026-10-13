# 153 — Default Cardano schemes register after customizers, only where no scheme answers

**Context.** Review round 2, finding 1. WP13 registered the YAML Cardano schemes per exact network, at the highest customizer precedence. Core looks up exact keys before patterns, so an application's `register("cardano:*", …)` (plan §1a: "customizers override") was shadowed on the server (its money parser and Masumi issuer ignored) and on the client (an HSM signer lost to the YAML mnemonic wallet). The facilitator ignored wildcard claims too.

**Decision.**
- New SPIs in `org.x402.spring`, run by `X402AutoConfiguration` after every customizer:
  - `X402SchemeDefaults` (resource server);
  - `X402ClientSchemeDefaults` (client).
- The Cardano server defaults register `GuardedCardanoServerScheme` under each network string as written, only when `server.getRegisteredScheme(network, "exact")` is `null` (patterns included).
- The client defaults register a wallet only when `ClientSchemes.isRegistered` says no scheme answers. Core `X402Client` has no lookup; the probe runs `selectPaymentRequirements` on a dummy requirement and reads core's fixed "no scheme" messages ("No network/scheme registered…", "No client registered…"). **Core follow-up requested:** `X402Client.hasRegisteredScheme(network, scheme)` would replace the probe.
- The facilitator treats a network as claimed when a registered kind with the same scheme matches it as a pattern (`Networks.matchesPattern`, exact ids included).

**Tests.** `CardanoReviewRound2Test` (server and client `cardano:*` customizers) and `FacilitatorReviewRound2Test` (facilitator). Red first.

**Reverse.** Register the defaults as highest-precedence customizers again.
