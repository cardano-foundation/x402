# 007 — The starter bundles the Cardano mechanism and extensions

**Context.** The user's goal is "as easy as possible": one dependency plus `application.yml`. The plan has a separate `x402-mechanism-cardano` module and Cardano auto-configuration guarded by `@ConditionalOnClass`.

**Decision.** `x402-spring-boot-starter` depends on `x402-spring-boot-autoconfigure`, `x402-core`, `x402-mechanism-cardano` and `x402-extensions`. Adding the starter is enough to sell or buy on Cardano. The autoconfigure module keeps both as `optional`, so apps that want less can depend on autoconfigure directly.

**Alternatives.** A lean starter plus `x402-spring-boot-starter-cardano`, the per-chain starter pattern (cleaner once EVM exists, but one more artifact today).

**Consequences.** The starter pulls cardano-client-lib (~several MB). When EVM arrives, revisit with per-chain starters.

**Reverse.** Drop the two dependencies from the starter pom; nothing else changes.
