# 121 — The facilitator's public verify/settle are final; verification is one overridable method

**Context.** The WP7 review found that `settle` called the 2-argument `verify` while core calls the 3-argument one. A subclass that tightened only the 3-argument method would make `/verify` reject but `/settle` broadcast. Plan §3a level 6 says to wrap the default scheme, not subclass it.

**Decision.** All four public `verify`/`settle` overloads of `ExactCardanoFacilitatorScheme` are `final`. Pre-broadcast verification is one protected method, `verifyPayment`, which public verify and settle both run (decision 013), so an override tightens both alike. `runMethodSpecificChecks` stays protected for the same reason. `verifyBroadcast` (settle's resume of its own claim) is private. The Javadoc points to composition, plan §3a level 6.

**Alternatives.**
- Make the class final (also removes the coherent `verifyPayment` extension).
- Route through the 3-argument method (keeps two overridable entry points that can drift).

**Consequences.** Subclasses can no longer override the entry points; there were none in the repository.

**Reverse.** Drop `final` and make settle call the public SPI method.
