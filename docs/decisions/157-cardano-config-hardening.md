# 157 — Non-object deployments, several plain beans, CIP-34 aliases

**Context.** Review round 2, findings 7, 8 and 9.

**Decision.**
- A non-object `extra.deployment` fails startup with "extra.deployment must be an object {requiredAdmins, adminVkeys, cooldownPeriod}" instead of a `NullPointerException`.
- `NetworkBeans.resolve`: two or more plain beans of a type, none `@Primary`, fail startup, naming `@Primary` and `X402CardanoNetworkBeans`. Previously they were silently ignored.
- `CardanoServerPlan` keys networks, Masumi settings, sellers, escrows and the plain-bean network count by `CardanoNetworks.normalize`, so `cip34:0-1` and `cardano:preprod` are one network. Schemes are still registered under every spelling used, so requirement lookups find them. The client's `networks[]` count is not normalized (one entry per spelling, as written).

**Tests.** `CardanoReviewRound2Test#aNonObjectDeploymentFailsWithAClearMessage`, `#twoPlainSellerBeansFailUnlessOneIsPrimary`, `#cip34AliasesAreTheSameNetwork`. Red first.

**Reverse.** Local to `JsonShapes`, `NetworkBeans` and `CardanoServerPlan`.
