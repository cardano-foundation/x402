# 155 — Escrow receivers are detected by payment script hash

**Context.** Review round 2, findings 3 and 5. The escrow check compared exact bech32 strings with enterprise escrow addresses. A base address whose payment credential is the escrow script, with any stake part, passed both the startup check and the per-request guard. Deployments declared in `price.extra` were also missing from the pre-scan, so whether a plain option was caught depended on option order.

**Decision.**
- `CardanoServerPlan` keeps, per network, the escrow addresses and the escrow script hashes (`MasumiBlueprint.escrowScriptHash`) of the canonical deployment, the network deployment, and every `extra.deployment` declared on accounts, options **and `price.extra`**.
- `CardanoAddressRules` parses the receiver and refuses it when it equals an escrow address or when its payment credential is a script whose hash is an escrow script hash, whatever its stake part.

**Tests.** `CardanoReviewRound2Test#aBaseAddressWithTheEscrowScriptAsPaymentCredentialIsRefused`, `#aDeploymentDeclaredInPriceExtraIsKnownBeforeEarlierOptionsAreChecked`. Red first.

**Reverse.** Local to `CardanoAddressRules` and `CardanoServerPlan`.
