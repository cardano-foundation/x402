# 187 — Back-to-back payments from one wallet: documented, not worked around

**Context.** In the WP11 live check (2026-10-12, preprod) the Spring client paid `/weather` a few seconds after the plain client had paid `/report` from the same wallet. Blockfrost still listed the input the first transaction spent. The second payment reused it: the facilitator's verify passed (Blockfrost doesn't see mempool spends), the node rejected it at settle (`invalid_exact_cardano_payload_nonce_…`), and the client got the 402 back. Nothing was paid twice. A rerun a little later paid normally. The e2e client avoids this by waiting for the change output (decision 173); the SDK client signer has no such wait.

**Decision.** Document it in `java/README.md` (client section) and the `java-http` example README: wait until the previous payment is on chain before paying again from the same wallet. No code change in the examples, and no SDK change (outside WP11's files).

**Alternatives.** Copy the e2e client's wait into the examples (adds Blockfrost polling to a minimal example); an SDK-level input reservation (a design change for the client signer, WP8).

**Consequences.** A user scripting several payments in a row needs the wait. Reported to the orchestrator as an SDK follow-up candidate.

**Reverse.** n/a.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
