# 174 — WP10 phase 1 live check without `SERVER_CARDANO_SELLER_MNEMONIC`

**Context.** The local `e2e/.env` has `CLIENT_CARDANO_MNEMONIC`, `BLOCKFROST_PROJECT_ID` and `SERVER_CARDANO_ADDRESS`, but not `SERVER_CARDANO_SELLER_MNEMONIC`. The orchestrator's instruction: Masumi cannot run; record that and do not work around it. Two harness facts make **every** Cardano route unrunnable without the seller mnemonic, not only Masumi:
- `config/mechanisms_cardano.json` marks `SERVER_CARDANO_SELLER_MNEMONIC` `required: true`. `test.ts` exits with "Missing required environment variables" for any selected Cardano scenario.
- `servers/typescript/config.ts` (`case "cardano"`) registers the Cardano server scheme only when the seller mnemonic is set. Without it, no TS server can serve `/exact/cardano/*`. There are no Java servers until phase 2.

**Decision.** No dummy or throwaway seller mnemonic: that would be the forbidden workaround, and it would also run Masumi. Instead:
- The Java client was exercised on preprod for `default` and `script` only, against a **scratch** server outside the repo. The scratch server reuses the TS e2e server modules (same catalog routes and route configs) and the real TS e2e facilitator. Cardano is registered without a Masumi seller, and the Masumi route is not mounted.
- The client ran twice per route: directly through `run.sh`, and through the harness's own `GenericClientProxy` with the pass/fail checks of `runClientTest`. This covers `run.sh` resolution, credential and network env injection, and JSON parsing.
- The WP10 Check command is **not** met and is recorded as blocked on the seller mnemonic.

**Alternatives.**
- Stop with no live evidence: the client would ship untested.
- A dummy seller mnemonic: refused, as above.
- Make the seller mnemonic optional in the catalog or the TS server: changes harness behaviour for TS, which is out of scope.

**Consequences.** Evidence for `default` and `script` comes from one substitute run, not from a harness run. Masumi is untested for the Java client.

**Reverse.** n/a. Rerun the WP10 Check once a seller mnemonic is available.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking. Flagged for user sign-off in the final report.
