# WP-10: Java servers and client pass the Cardano e2e routes; CI builds Java
Tier: R1
Base: f8f83309 (no checkpoint commits, decision 001)
Check: (1) `cd e2e && pnpm test --testnet --families=cardano --sdk=java,ts --facilitators=typescript` passes, and the results list /exact/cardano/{default,script,masumi} for each of: spring-mvc × TS client, spring-webflux × TS client, TS server × java-http client, Java server × java-http client; bazaar discovery validation passes for the Java servers. (2) `pnpm test --testnet --families=cardano --sdk=java` passes all three routes for the all-Java scenarios (Java servers × java-http × Java facilitator)

## Allowed files
- e2e/src/component.ts
- e2e/src/mechanisms.ts
- e2e/setup.sh
- e2e/config/mechanisms_cardano.json
- e2e/servers/java/**
- e2e/clients/java/**
- e2e/facilitators/java/**
- e2e/README.md
- .github/workflows/e2e_tests.yml
- docs/**

## Rules
- **Harness:** add `java` to:
  - LANGUAGES (`e2e/src/component.ts:16`)
  - `SdkId` and the enrich allowlist (`e2e/src/mechanisms.ts:28`, `:686-689`)
  - the `setup.sh` language case (`:167-170`) and `has_setup_work` (`:111-114`)
  - `e2e/src/cli/filters.ts` already passes "java" through.
- Each component ships test.config.json, build.sh (installs the java reactor, then packages the app) and run.sh.
- **Servers** `e2e/servers/java/http/{spring-mvc,spring-webflux}`: Spring Boot apps using the starter.
  - Routes come from the catalog (`E2E_MECHANISMS_CATALOG`, else walk up to config/mechanisms_global.json, like `e2e/servers/go/catalog.go:162-185`) and become `x402.routes.*` with `path:` and one `accepts` entry per catalog route: `account:` picks the per-method account (below), and the catalog `extra` (script block, `paymentFlow`) goes into that entry's `extra`. There is no offer-level `extra` (plan Roles §1a rule 4).
  - One route is additionally served by an annotated controller, so the annotation path runs in e2e.
  - Honour `MOCK_FACILITATOR_URL` as a second facilitator client (cf. `e2e/servers/typescript/config.ts:61-67`): `x402.facilitators` = `[{url: FACILITATOR_URL}, {url: MOCK_FACILITATOR_URL}]` in that order (the same list shape as TS). This makes the Java e2e server the repo's second runnable multi-facilitator configuration.
  - Print `Server listening`; GET /health; POST /close; success body `{"message":"Protected endpoint accessed successfully","timestamp":…}`.
  - Env: PORT, FACILITATOR_URL, SERVER_CARDANO_*, CARDANO_L1_CONFIRMATIONS. They map to accounts like `e2e/src/mechanisms.ts:925-955`: `cardano` (SERVER_CARDANO_ADDRESS), `cardano-masumi` (derived escrow, seller mnemonic), `cardano-script` (SERVER_CARDANO_SCRIPT_ADDRESS, else the always-succeeds address); CARDANO_L1_CONFIRMATIONS → each account's `cardano.l1-confirmations`. Catalog routes pick the account by transfer method.
- **Client** `e2e/clients/java/http/java-http`: one-shot; prints one JSON line `{success,data,status_code,payment_response[,error]}`; exits 0; request timeout 240 s (X402HttpClient default); **spend controls disabled**, like the TS e2e client (`e2e/clients/typescript/client.ts:389`), because the routes are priced in lovelace. Env: RESOURCE_SERVER_URL, ENDPOINT_PATH, CLIENT_CARDANO_MNEMONIC, BLOCKFROST_PROJECT_ID, CARDANO_RPC_URL (→ one `x402.client.cardano.networks[]` entry with `blockfrost.base-url` = CARDANO_RPC_URL).
- **Facilitator** `e2e/facilitators/java`: a Spring Boot app using the WP12 facilitator server at the root base path.
  - Prints `Facilitator listening` (`e2e/src/facilitators/generic-facilitator.ts:76`); GET /health; POST /close.
  - Env: PORT (default 4022), CARDANO_RPC_URL + BLOCKFROST_PROJECT_ID (Cardano registered only when both are set), FACILITATOR_CARDANO_MNEMONIC (optional → provider-only), CARDANO_NETWORK (→ one `networks[]` entry), and CARDANO_L1_CONFIRMATIONS=-1 → accept-mempool (mirrors `e2e/facilitators/typescript/index.ts:411-430`, `:826-830`).
  - `test.config.json` declares `"extensions": []`. The Java facilitator has no `/discovery/resources`, so bazaar validation must not target it.
  - It inherits all three Cardano routes once `java` is enriched. Unfiltered Cardano runs therefore include it for every server × client pair, which is intended (full matrix).
- `mechanisms_cardano.json`: add "java" to the three routes' `sdks`; nothing else changes.
- **CI:** add `actions/setup-java` (temurin 17, maven cache) to e2e_tests.yml before ./setup.sh. No secrets. The CI Cardano family stays unselected until a SERVER_CARDANO_SELLER_MNEMONIC secret exists; report it, don't work around it.
- Existing TS/Go/Python components must behave the same.

## Proof commands
- red-first: no new unit tests; record an e2e run before the harness change showing the java components are not discovered
- green: the Check command (preprod, local .env), and `cd e2e && pnpm test --testnet --min --transport=http` unchanged for existing languages
- scope: ~/.claude/bin/check-scope.sh docs/work/wp-10-e2e-and-ci.md

## Log
- 2026-10-12 **Phase 1** (harness + java-http client + CI). Servers (spring-mvc, spring-webflux) and the Java facilitator are phase 2. Base f8f83309 plus the other packages' working tree.
- red-first (manual, decision 001): `e2e/clients/java/http/java-http` was written first, with the harness untouched. `SERVER_SVM_ADDRESS= SERVER_EVM_ADDRESS= pnpm test --testnet --families=cardano --clients=java/http/java-http --servers=typescript/http/express --facilitators=typescript -v`: "Clients found: 13", java-http not among them, then "No scenarios match the selections".
- Harness change: `java` added to LANGUAGES, `SdkId`, the enrich allowlist, the `setup.sh` language case and `has_setup_work` (plus a `pom.xml` default build, decision 172), and to the three Cardano routes' `sdks`.
  - Discovery dump (scratch script over `TestDiscovery`, before vs after): every existing component config and all 3052 existing scenarios are byte-identical.
  - The only additions are `java/http/java-http` (protocolFamilies `[cardano]`, schemes `[exact]`) and 12 scenarios: java-http × TS express/fastify/hono/next × typescript facilitator × default/masumi/script.
  - `tsc --noEmit` reports no errors in `src/` or `test.ts`. The 28 errors it does report are in TS component files that WP10 does not touch.
- `./setup.sh`: 16/16 components OK, including `client/java/http/java-http` (reactor install, then package). No tracked Go or Python files changed.
- green (Check 1): **BLOCKED**. `test.ts` exits with "Missing required environment variables: SERVER_CARDANO_SELLER_MNEMONIC" for any Cardano selection (catalog `required: true`). Without that variable, `servers/typescript/config.ts` also registers no Cardano scheme. So no Cardano route can run through the harness, Masumi or not. Not worked around (decision 174).
- Substitute live check (preprod, decision 174): a scratch server outside the repo, built from the TS e2e server modules, with Cardano registered without a Masumi seller and the masumi route not mounted. It used the real TS e2e facilitator (provider-only).
  - `run.sh` direct: /exact/cardano/default → 200, settle success, tx 287d2c85…4d39, exit 0. /exact/cardano/script → 200, settle success, tx 1f04092b…4b7c, exit 0.
  - Via the harness `GenericClientProxy`, with the `runClientTest` checks: default PASS (tx 305bebe8…9bf1, 110 s including the wallet-settle wait); script PASS (tx 4c257201…133b, 32 s).
  - masumi: NOT RUN (no seller mnemonic).
- Existing languages: `pnpm test --testnet --min --families=evm,svm --versions=2 --transport=http`. This is the CI selection from `scripts/ci-select-families.sh` on the local .env. Result: 143 selected, 103 passed, 40 failed, no java component in the run. The failures already happen without WP10 and do not involve Java:
  - 20 × Go servers fail to start with the python facilitator ("Facilitator does not support scheme auth-capture on eip155:84532"). Reproduced alone with go/http/gin + python.
  - 18/18 SVM scenarios (402s, smart-wallet fee-payer isolation).
  - 2 × auth-capture authorizer signature.
- Env prep (decision 175): the TS SDK dists were stale (April) and the TS facilitator could not start, so they were rebuilt with `turbo run build` (CI runs `pnpm build`). pnpm's automatic install rewrote `e2e/pnpm-lock.yaml` (it pruned the stale `external-proxies/cdp*` importers). The file was restored to its HEAD content afterwards.
- CI: setup-java (temurin 17, maven cache, pinned to `c1e32368… # v4.8.0` as in java.yml) added before setup.sh, gated like Go/uv (decision 176). No secrets. CI's `.env` step writes no `SERVER_CARDANO_SELLER_MNEMONIC` line, so CI never selects Cardano.
- Rule text notes:
  - Client: "exits 0" holds when the server answered. When the request cannot complete, the client exits 1 with a JSON error, because exit 0 plus an error line is a harness false green (decision 170). The Go client has that latent false green.
  - The client uses the core API (`X402Client` + `ExactCardanoClientScheme` + `MnemonicClientCardanoSigner` + `BlockfrostChainBackend`), not the Spring `x402.client.cardano.networks[]` config. `CARDANO_RPC_URL` maps to the `BlockfrostChainBackend` `baseUrl`.
  - The reactor path from the component is `../../../../../java/pom.xml` (decision 171).
  - The client waits for the change output like the TS client (decision 173).
- Scope (decision 001: review of git status instead of check-scope.sh): e2e/src/component.ts, e2e/src/mechanisms.ts, e2e/setup.sh, e2e/config/mechanisms_cardano.json, e2e/clients/java/** (including a .gitignore for target/), e2e/README.md, .github/workflows/e2e_tests.yml, docs/work/wp-10-e2e-and-ci.md, docs/decisions/170–176 and their README rows.
- 2026-10-12 **Phase 2**: servers spring-mvc and spring-webflux, plus the Java facilitator, built against the completed SDK in ~/.m2 (WP12, WP13, WP9b included).
  - Servers: decisions 177 (properties from the catalog), 178 (handlers, annotated route), 179 (Masumi without a seller).
  - Facilitator: decision 190.
  - Live method: decision 191. Build: decision 192.
  - No `e2e/src` change was needed: `"extensions": []` already makes `validateFacilitatorDiscovery` skip the Java facilitator.
- Build: `./setup.sh` → 19/19 OK (server/java/http/spring-mvc, server/java/http/spring-webflux, client/java/http/java-http, facilitator/java included). No tracked files changed. `e2e/pnpm-lock.yaml` unchanged.
- Discovery dump (phase-1 script):
  - 3139 scenarios (3064 after phase 1, 3052 at base).
  - 0 lines removed or changed against either earlier dump.
  - New components: `java` facilitator (`[cardano]`, `[exact]`, `extensions: []`), `java/http/spring-mvc` and `java/http/spring-webflux` (`[cardano]`, `[exact]`, `extensions: [bazaar]`, three endpoints each).
  - 75 new scenarios: TS/java clients × Java servers × {typescript, java} facilitators, and TS/java clients × TS servers × java facilitator, each × 3 routes.
- Check 1/2 via the harness: still **BLOCKED** on `SERVER_CARDANO_SELLER_MNEMONIC` (decision 174). Components were run directly on preprod, with the masumi route left out by the servers (decision 179). Each line gives settle success, HTTP 200 and the tx id:
  - (a) java-http × spring-mvc × TS facilitator: default `050dfc33…cbf29`, script `b07485be…d577e`.
  - (a) java-http × spring-webflux × TS facilitator: default `c5e3f97b…789e7`, script `42af7d6f…82fd5`.
  - (b) java-http × TS server (scratch, no Masumi seller) × Java facilitator: default `52f4466a…04c0c`, script `9536a6d1…7f716`.
  - (c) java-http × spring-mvc × Java facilitator: default `e43d4b9f…fcd91`, script `f96be2aa…05e2b`.
  - (c) java-http × spring-webflux × Java facilitator: default `4bb48d6a…ab965`, script `c743cb25…19da0`.
  - (d) TS fetch × spring-mvc × TS facilitator: default `831a4127…43431`, script `f72c445a…3267d`.
  - Through the harness proxies (`GenericFacilitatorProxy` java + `GenericServerProxy` spring-mvc/webflux + `GenericClientProxy` java-http):
    - ready lines detected; health OK; close OK on all three.
    - spring-mvc default paid: `545e51a6…7a2d611`.
    - drift check: only `/exact/cardano/masumi → 404`, expected without a seller.
  - Two-facilitator config (Java facilitator + harness mock facilitator via `MOCK_FACILITATOR_URL`): spring-mvc starts and default settles via the first facilitator (`cb427065…613cc`).
- The first two attempts of (a) on spring-mvc failed: `settlement_failed`, then `nonce_not_on_chain`. The cause was a concurrent agent's example run spending the same single-UTxO client wallet (tx `ac719a97…`, 18:15:22 UTC). This is not an SDK bug (decision 191); every rerun passed on the first attempt.
- Parity with the TS express e2e server (unpaid 402s, same facilitator and env):
  - default/script: `accepts` equal field for field, and bazaar `info` + `schema` equal.
  - masumi (startup/402-shape check only, throwaway seller key, no payment, decision 179): identical key paths, escrow `payTo`, `sellerAddress`, `referenceKey`, amount/asset/timeout. Only per-request values differ.
- Java facilitator `/supported` equals the TS facilitator's Cardano kind; `/discovery/resources` → 404.
- SDK bugs found: none.
- Rule text notes:
  - The facilitator base path is `/` (documented as root), not `""` (decision 190).
  - The annotated route is fixed to `/exact/cardano/default` (decision 178).
  - The servers' `/health` body is `{status, version, routes}`, not the TS per-network payee map.
- Scope (phase 2): e2e/servers/java/** (shared `src/`, `http/spring-mvc`, `http/spring-webflux`, `.gitignore`), e2e/facilitators/java/**, e2e/README.md (Java components section), docs/work/wp-10-e2e-and-ci.md, docs/decisions/177–179 and 190–192 with their README rows.
- 2026-10-12 **Review fixes** (independent review, no blockers):
  - (1) False green fixed (decision 193).
    - Servers exit 1 before `Server listening` unless `X402ServerLifecycle.status()` is READY. Checked with a closed facilitator port on both stacks: exit 1, no ready line, reason on stderr.
    - java-http: `success` only on 2xx; any non-2xx other than 402 exits 1 with `error`. Checked against a 503 fixture: exit 1.
  - (3) `build.sh` uses `mvn -q clean package` (decision 194).
  - (5) The README setup section states the JDK 17+ / Maven prerequisite.
  - (6) `flatten()` keeps JSON types; arrays become one List value, because index keys would bind as maps. A scratch catalog with typed `requirementsExtra` gives `{e2eFlag:true, e2eCount:7, e2eRatio:1.5, e2eNested:{n:2,s:"x"}, e2eList:[1,"a"]}` on the wire (decision 194).
  - All three Java components were rebuilt.
- Live re-run after the fixes: java-http × spring-mvc × TS facilitator, /exact/cardano/default → 200, settled, tx `2ad160fa…5aa75`, exit 0. Wallet checked idle first: no other agent processes, and the last wallet txs were this package's own.
- (4) CI cost without coverage: accepted under decision 176. CI builds the Java components in `setup.sh` (one reactor install each) but never selects Cardano without the seller secret. To skip them later, add a language skip to `setup.sh`'s language case, e.g. an env var such as `E2E_SKIP_LANGUAGES=java` checked in `process_role_v2` and `process_directory_flat`, set in `e2e_tests.yml` while `cardano` is not among the selected families.
- Scope (review fixes): e2e/servers/java/src/**, e2e/clients/java/http/java-http/{build.sh, Main.java}, e2e/README.md, docs/decisions/193–194 with their README rows, this Log.
