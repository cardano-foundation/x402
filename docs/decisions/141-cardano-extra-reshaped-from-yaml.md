# 141 — Cardano `extra` values bound from YAML are reshaped to JSON form

**Context.** Spring binds `Map<String, Object>` values as strings and nested maps. A list arrives as a map keyed `"0"`, `"1"`, …, and a number arrives as a string. The Cardano scheme and facilitator need JSON types: `confirmationPolicy.l1Confirmations` must be an integer (`CardanoPolicies` rejects strings), and `deployment.adminVkeys` must be an array.

**Decision.** `CardanoOptionContributor` rewrites, on Cardano `exact` options only:
- `extra.confirmationPolicy` → `{l1Confirmations: <int>}`. Strings of digits are accepted; anything else, or a value outside −1..20, fails startup.
- `extra.deployment` → `MasumiDeployment.toJson()`, with index-keyed maps restored to lists. The deployment also adds its escrow address to the network's escrow set.

Typed account fields (`cardano.l1-confirmations`, `cardano.masumi.deployment.*`) are bound by `X402CardanoProperties` and need no reshaping.

**Alternatives.** Leave the values as bound. TS-shaped YAML would then silently produce requirements the facilitator rejects.

**Reverse.** Drop the rewrite in `CardanoOptionContributor`.
