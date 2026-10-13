# 010 — Optional TS scheme members are default methods

**Context.** WP2 listed optional capabilities as separate interfaces (`AssetDecimalsProvider`, `SettleOnCancelProvider`, `DynamicExtraFieldsProvider`, `PaymentRequiredEnricher`). TS models them as optional members of `SchemeNetworkServer` (`getAssetDecimals?`, `settleOnCancel?`, `dynamicExtraFields?`, `enrichPaymentRequiredResponse?`, `enrichSettlementPayload?`, `enrichSettlementResponse?`, `validateFacilitatorSupport?`, `schemeHooks?`).

**Decision.** Each optional member is a `default` method on `SchemeNetworkServer` / `SchemeNetworkClient`, returning `null` or an empty list, meaning "not implemented". One interface to implement, the same shape as TS, and core checks for `null` instead of `instanceof`.

**Alternatives.** Marker capability interfaces (more types; `instanceof` checks in core).

**Consequences.** Adding a new optional member later is source-compatible.

**Reverse.** Extract interfaces; implementations keep compiling if the defaults stay.
