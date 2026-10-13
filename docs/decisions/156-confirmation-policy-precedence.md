# 156 — Confirmation policy precedence; `OptionDraft` exposes the declared `extra` and the timeout

**Context.** Review round 2, finding 6. Plan §1a rule 3 puts `price.extra` below the account and the option. The contributor read the merged `extra`, so a `price.extra.confirmationPolicy` beat the account's `cardano.l1-confirmations`.

**Decision.**
- `OptionDraft` gains `declaredExtra()` (account ← option, plus contributions, without `price.extra`) and `maxTimeoutSeconds()`. Both are additive.
- Precedence: a policy in the option's or account's `extra` > the account's `cardano.l1-confirmations` > a policy in `price.extra`.

**Test.** `CardanoReviewRound2Test#accountL1ConfirmationsBeatAConfirmationPolicyInPriceExtra`. Red first.

**Reverse.** Read the merged `extra` again.
