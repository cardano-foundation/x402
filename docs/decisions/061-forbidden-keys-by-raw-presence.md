# 061 — Misplaced keys are detected on the raw property sources

**Context.** Plan §1a rules 2 and 4 make offer-level `price`, `price-ref`, `accounts`, `network`, `pay-to`, `pay-to-ref`, `extra`, `facilitator`, `scheme`, `max-timeout-seconds` and `x402.defaults.extra` startup errors. The binder silently ignores unknown fields, and `ignoreUnknownFields=false` is ruled out because WP13 binds `accounts.*.cardano` over the same prefix.

**Decision.** `RawProperties.presence(environment)` checks each forbidden name (and its descendants) on Spring's `ConfigurationPropertySources`, so YAML, properties, env vars and `SPRING_APPLICATION_JSON` are all covered. `OfferResolver` takes the predicate; the error names the offer and the field and says where it belongs.

**Alternatives.** Typed "forbidden" fields on the records (they would show up in IDE completion as if valid); `ignoreUnknownFields=false` (breaks WP13).

**Consequences.** Unknown keys other than the listed ones are still ignored (e.g. typos in optional fields).

**Reverse.** Drop the presence checks in `OfferResolver.checkOfferLevel`.
