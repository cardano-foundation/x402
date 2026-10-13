# 179 — Java e2e servers leave the Masumi route out without a seller mnemonic; Masumi config checked by 402 shape only

**Context.** The coordinator's rule: without `SERVER_CARDANO_SELLER_MNEMONIC`, the Masumi route must be left out rather than failing startup. The starter itself fails startup for a Masumi option on a network with no seller (plan §1a rule 7). The local `.env` has no seller mnemonic, and Masumi must not be worked around (decision 174).

**Decision.**
- **No seller mnemonic.** `E2eServerConfig` drops `/exact/cardano/masumi` and its `cardano-masumi` account, and prints `skipped /exact/cardano/masumi (no SERVER_CARDANO_SELLER_MNEMONIC)`. The other routes start normally.
  - The harness drift check (`GenericServerProxy.verifyPaidRoutes`) then reports `/exact/cardano/masumi → 404`. That run state never occurs: `test.ts` refuses every Cardano run without the seller mnemonic, and the TS servers register no Cardano scheme at all without it.
- **Config check only.** To check that the Masumi offer is built correctly when a seller exists, spring-mvc and the real TS express e2e server were both started with one **throwaway** BIP-39 mnemonic. It was generated in-process with cardano-client-lib, held only in a shell variable, never funded and never written to disk.
  - Only the unpaid 402s were compared. **No Masumi payment was made.**
  - Result: both start, and the Masumi `accepts` entries have identical key paths.
  - `payTo` (the canonical preprod escrow), `terms.sellerAddress`, `referenceKey`, `amount`, `asset`, `maxTimeoutSeconds: 600`, `network` and `scheme` are equal.
  - Only per-request values differ: nonce, times, signature, and the commitment over the port-bound resource URL.

**Alternatives.**
- Fail startup without the seller: the brief rules this out.
- Run a Masumi payment with the throwaway seller: forbidden (decision 174).
- Skip the shape check: the Masumi offer path would ship completely unexercised.

**Consequences.** The Masumi payment path stays untested end to end until a real seller mnemonic exists.

**Reverse.** Remove the skip in `E2eServerConfig`.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking. Flagged for user sign-off in the final report: the throwaway-key shape check is a judgment call.
