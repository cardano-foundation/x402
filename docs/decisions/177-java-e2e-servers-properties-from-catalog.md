# 177 — Java e2e servers build their x402 properties from the catalog at startup

**Context.** WP10 phase 2: `e2e/servers/java/http/{spring-mvc,spring-webflux}` must take their routes from the catalog, as the TS, Go and Python servers do. The configuration is the starter's `x402.*` YAML: accounts per transfer method, one `accepts` entry per route, the catalog `extra` on that entry, and bazaar from the catalog.

**Decision.**
- **Shared code.** `e2e/servers/java/src/main/java/org/x402/e2e/server/` holds:
  - `E2eCatalog`: loads `E2E_MECHANISMS_CATALOG`, otherwise walks up to `config/mechanisms_global.json`, like `servers/go/catalog.go`. It keeps routes whose `sdks` list `java`, honours `E2E_EXCLUDE_SCHEMES` / `E2E_EXCLUDE_NETWORKS`, `requiresEnv` and `requiresEnvAbsent`, and keeps file order.
  - `E2eServerConfig`: builds the properties map.
  - `E2eServerLifecycle`: start, ready line, `/health` and `/close`.

  Both apps compile this directory through `build-helper-maven-plugin` `add-source`. There is no extra artifact to install. The layout mirrors the language-root modules of Go and Python.
- **Properties go in as `SpringApplication` default properties** (flat relaxed keys such as `x402.routes.<offer>.accepts[0].price.amount`). There is no generated YAML file and no `EnvironmentPostProcessor`. Default properties have the lowest precedence, and nothing else in the app sets `x402.*`.
- **Accounts.** There is one account per (network, transfer method):
  - `cardano`: `pay-to` = `SERVER_CARDANO_ADDRESS`.
  - `cardano-script`: `pay-to` = `SERVER_CARDANO_SCRIPT_ADDRESS`, else the always-succeeds fixture; `extra.assetTransferMethod: script`.
  - `cardano-masumi`: no `pay-to`, so the starter derives the escrow address; `extra.assetTransferMethod: masumi`; `cardano.masumi.seller-mnemonic`.

  `CARDANO_L1_CONFIRMATIONS` is validated like the TS harness (an integer from −1 to 20) and becomes each account's `cardano.l1-confirmations`. The network comes from `CARDANO_NETWORK`, else the catalog's testnet CAIP-2. The transfer method sits on the account, so the starter's transfer-method lock (§1a rule 5) keeps a plain option off the escrow account.
- **Offers.** Each offer is named after its path (`/exact/cardano/script` → `exact-cardano-script`) and has one `accepts` entry with:
  - `account`;
  - `price: {amount, asset}` (`amountEnv`/`assetEnv` override; a catalog `usd` price would become a money string);
  - `max-timeout-seconds` from the catalog;
  - `extra`: the catalog `requirementsExtra`, the script block (`script.type`, `script.code`, `datum`, with the same env overrides as TS), `paymentFlow` when it is not `authorization`, and `schemeExtra`.

  There is no offer-level `extra`.
- **Bazaar** `extensions.bazaar.output.{example, schema}` matches the TS `routeDiscoveryOutput()`. The 402's `extensions.bazaar` `info` and `schema` are byte-equal to the TS express server's for all three routes.
- **Skips.** A network without `SERVER_<ID>_ADDRESS` drops its routes, as TS does. A catalog extension other than `bazaar`, or a `settlementOverride`, fails startup, so catalog drift is loud.
- **Facilitators:** `x402.facilitators[0].url = FACILITATOR_URL`, plus `[1] = MOCK_FACILITATOR_URL` when it is set.

**Alternatives.**
- A shared Maven module installed by each `build.sh`: an extra artifact and an extra install step.
- A generated `application.yml`: an extra file and quoting pitfalls (plan: SnakeYAML and CAIP-2 ids).
- An `EnvironmentPostProcessor`: needs a `spring.factories` entry for the same effect.

**Consequences.**
- On preprod, the 402 `accepts` for default and script equal the TS express server's: all fields, with `extra` including `areFeesSponsored`.
- The Masumi 402 has identical structure, escrow `payTo` and seller address (decision 179).

**Reverse.** Replace `E2eServerConfig` with a static `application.yml` per app.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
