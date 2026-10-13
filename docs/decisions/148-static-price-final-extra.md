# 148 — Static-price options carry the final merged `extra`

**Context.** Review finding 5. For a static object price, `PaymentOption.extra` held only account ← option. The `price.extra` layer was merged by core at build time. Core's constructor and startup checks (transfer method, flow) and the starter's streaming predicate saw `option.extra`, so a method declared only in `price.extra` was validated as `default`.

**Decision.** For a static price, `PaymentOption.extra` is the final merge `price.extra` ← account ← option (plus contributions). Core's build-time merge then yields the same wire `extra`. For a `price-ref`, `price.extra` is unknown at startup and is guarded per request (decision 071).

**Tests.** `ReviewFindingsTest#aTransferMethodOnlyInPriceExtraIsSeenAtStartup`: `prepaid` is visible on the option, and `nope` fails startup.

**Reverse.** Restore account ← option only.
