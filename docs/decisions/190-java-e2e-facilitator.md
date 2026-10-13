# 190 — Java e2e facilitator: root base path `/`, env mapping, no bazaar

**Context.** WP10: `e2e/facilitators/java` is a Spring Boot app on the starter's facilitator server, at the root base path. It has the env mapping of `e2e/facilitators/typescript/index.ts:411-430` and `:826-830`, `test.config.json` `"extensions": []`, and bazaar validation must not target it.

**Decision.**
- **Properties.** They are set as `SpringApplication` default properties from env:
  - `server.port` = `PORT` (default 4022);
  - `x402.facilitator-server.enabled=true` and `base-path=/`;
  - `cardano.accept-mempool` = (`CARDANO_L1_CONFIRMATIONS` is `-1`);
  - one `cardano.networks[0]` entry (`network` = `CARDANO_NETWORK`, default `cardano:preprod`; `blockfrost.base-url` = `CARDANO_RPC_URL`; `blockfrost.project-id`; `mnemonic` = `FACILITATOR_CARDANO_MNEMONIC` when set), only when both `CARDANO_RPC_URL` and `BLOCKFROST_PROJECT_ID` are set.
- **Base path `/`, not `""`.** `X402FacilitatorServerProperties` documents both as root. The empty string is avoided because an empty bound value could fall back to the `@DefaultValue("/x402")`. With `/`, the routes are exactly `/verify`, `/settle` and `/supported` (decision 152), next to the app's own `GET /health` and `POST /close`.
- **Ready line.** `Facilitator listening on http://localhost:<port>` is printed on `ApplicationReadyEvent`. The harness waits for "Facilitator listening".
- **Bazaar.** With `test.config.json` `"extensions": []`, the harness's own check skips the facilitator: `facilitatorSupportsBazaar` is false, and `validateFacilitatorDiscovery` returns success without fetching (`e2e/extensions/bazaar.ts:121-123`, `:326-339`). **No `e2e/src` change was needed.** `GET /discovery/resources` answers 404.

**Evidence.**
- `/supported` returns the same Cardano kind as the TS facilitator: transfer methods, `areFeesSponsored:false`, `l1Confirmations` 0..20, and signers `cardano:*: []` when provider-only.
- Started through the harness `GenericFacilitatorProxy`: health OK and close OK.
- Settled default and script for java-http (behind the Java and TS servers) and for the TS server (decision 191).

**Alternatives.** `base-path: ""`, relying on binding semantics for an empty string.

**Reverse.** Change the properties in `FacilitatorApplication.properties`.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
