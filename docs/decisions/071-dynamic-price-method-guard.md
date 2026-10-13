# 071 — The `price-ref` transfer-method guard is generic

**Context.** Plan §1a rule 6 (Cardano section) refuses a `price-ref` result whose `extra.assetTransferMethod` differs from the startup-resolved method, so startup checks (escrow derivation) stay valid.

**Decision.** The check is mechanism-independent, so `OfferResolver` wraps every `price-ref` bean: a returned `AssetAmount` whose `extra.assetTransferMethod` differs from the option's final `extra` (absent = `default`) throws; the filter answers 500 and logs; no 402 is issued.

**Reverse.** Remove `OfferResolver.guarded`; WP13 would add it in a Cardano hook.
