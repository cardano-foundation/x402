# 158 — Masumi template rules are checked at startup

**Context.** Review round 2, finding 10. `MasumiQuoteIssuer.assertMasumiTemplate` (only template keys in `extra`; the last escrow deadline inside the seller's horizon; a deployment; `payTo` = escrow) ran only when a 402 was built, so a bad offer failed on its first request.

**Decision.** `CardanoOptionContributor` runs `assertMasumiTemplate` for every Masumi option at startup. It uses a template carrying the option's final `extra`, the derived escrow `payTo`, its `maxTimeoutSeconds`, and an issuer config with the network's seller and deployment (default deadlines and horizon, as the auto-registered issuer uses). Asset and amount are irrelevant to the check.

**Test.** `CardanoReviewRound2Test#masumiTemplateRulesAreCheckedAtStartup`: a 3,000,000 s timeout → "horizon"; an extra key → "may only carry"; a plain Masumi option still starts. Red first.

**Reverse.** Remove the call; errors surface per request again.
