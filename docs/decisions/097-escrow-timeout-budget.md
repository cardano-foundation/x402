# 097 — The timeout budget counts four settles for escrow

**Context.** Review finding O2. The startup budget warning (plan §1b, decision 036) assumed one settle plus its pending retry (2 × settle). Escrow settles before **and** after the handler, each with a pending retry, so its worst path is about 4 × settle (verify is skipped, but counting it keeps the estimate conservative).

**Decision.** `checkBudget` resolves each option's flow from its declared `extra` (scheme default otherwise); escrow uses 4 × the largest settle timeout, every other flow 2 ×. With defaults an escrow option warns (15 + 4 × 90 = 375 s > 240 s). The plan's §1b "Timeout budget" bullet now says so. Test: `RouteValidationReviewTest#o2EscrowCountsFourSettlesInTheTimeoutBudget`.

Also (finding O1, no separate decision): a skip-handler directive on a flow that does not settle after the handler (upfront) settles nothing, exactly as TS; `X402HttpResourceServer` now logs a WARNING and documents it. Test: `RouteValidationReviewTest#o1SkipHandlerOnAnUpfrontFlowWarnsThatNothingWasSettled`.

**Reverse.** Drop `settlesPerPayment` in `X402HttpResourceServer`.
