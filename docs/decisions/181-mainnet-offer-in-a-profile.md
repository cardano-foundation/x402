# 181 — The preprod + mainnet offer lives in a `mainnet` profile

**Context.** WP11 wants the server example to show one offer accepting on preprod and mainnet. At startup, when every facilitator answered and an option has no facilitator kind, startup fails (plan §1b, TS parity). With that offer in the default `application.yml`, the walkthrough's facilitator would have to list `cardano:mainnet`, which needs a mainnet Blockfrost project, only to run a preprod demo. `@X402Payment` naming an offer that doesn't exist fails startup too, so the handler cannot simply stay in the default profile.

**Decision.** `application-mainnet.yml` adds the `mainnet` account and the `market` offer (0.25 USDM on preprod or on mainnet). `MarketController` carries `@Profile("mainnet")`. The default profile needs only a preprod facilitator. `ExampleProfilesSmokeTest` starts the `mainnet` profile against WireMock and checks both options and the mainnet receiver.

**Alternatives.**
- Default profile with mainnet: every walkthrough needs a mainnet Blockfrost project.
- A `path:` offer in the profile over an always-present handler: the endpoint would be free in the default profile, which is a confusing demo.

**Consequences.** The two-network offer is one `--spring.profiles.active=mainnet` away. Nothing in the examples pays on mainnet: both clients register preprod only.

**Reverse.** Move the account and offer into `application.yml` and drop `@Profile`.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
