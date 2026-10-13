# 047 — The confirmation wait cannot spin on a fixed Clock

**Context.** TS polls evidence until `Date.now() + poll >= deadline`. Java injects `java.time.Clock`; with `Clock.fixed` (tests) a clock-only loop would never end.

**Decision.** `awaitEvidence` counts elapsed time as the larger of the clock's progress and the time actually slept, and treats a poll interval below 1 ms as 1 ms. With a real clock this equals TS; with a fixed clock it ends after `timeout / poll` polls. The Blockfrost backend's inclusion wait uses the same rule.

**Alternatives.** A `Sleeper` option (more API); ignoring the Clock for the wait (breaks the "time is injected" rule).

**Consequences.** `SettlementFlowTest.theConfirmationWaitEndsOnAFixedClock` pins it.

**Reverse.** Replace the loop's elapsed computation.
