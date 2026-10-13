# 173 — Java e2e client waits for the change output like the TS client

**Context.** e2e clients are separate one-shot processes that run back to back on one wallet. Blockfrost does not see mempool spends. A client started right after a settled payment can therefore build on the input that payment just spent. The TS client handles this in `awaitCardanoWalletSettled` (`e2e/clients/typescript/client.ts`): it polls `/addresses/{payer}/utxos` every 3 s, for up to 120 s, until the output of the settle transaction is listed.

**Decision.**
- The Java client does the same after a `cardano:*` settle response that has `transaction` and `payer`. It polls through the SDK's `BlockfrostChainBackend.getAddressUtxos`.
- A failed poll is logged to stderr and polling continues.
- On timeout the client logs and returns. The result line is still printed.

**Alternatives.**
- No wait: consecutive Cardano scenarios become flaky.
- Wait in the harness: this would change TS, Go and Python behaviour.

**Consequences.** A paid scenario can take up to 120 s longer. Observed on preprod: 31–110 s end to end.

**Reverse.** Remove `awaitWalletSettled` from `Main.java`.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
