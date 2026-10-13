# 040 — Post-eviction outcome (b) corrected against TS

**Superseded in part by [013](013-cardano-replay-guard.md)** (security divergence from TS): public verify no longer treats ledger evidence as validity, so outcome (b) is now a failure (`invalid_exact_cardano_payload_nonce_not_on_chain`) for every backend. Outcome (a) is unchanged. The text below records the TS behaviour Java mirrored before 013.

**Context.** Decision 006 and the WP7 rules said: after a submitted claim is evicted and the transaction is already included, "verify sees the nonce spent → failure for a payment that landed". Reading TS `exact/facilitator/scheme.ts:795-808` during the WP7 Step 0 review showed that verify first asks the backend for evidence of this exact transaction. When the backend can read evidence (Blockfrost) and the transaction is on chain, `acceptedByLedger` is true and the spent-input check is skipped. The retry resubmits the identical bytes, the node rejects them as already spent, and the submit-failure path asks the ledger again, sees the transaction, marks it submitted and reports **success**.

**Decision.** Java mirrors TS (no behaviour change), and the stated outcomes are corrected:
- (a) still in the mempool → the node reports it known → success after confirmation;
- (b) already included, evidence-capable backend → success (the resubmission is rejected, the evidence shows it landed);
- (b') already included, backend without evidence → verify fails with `invalid_exact_cardano_payload_nonce_not_on_chain` although the payment landed.

In every case only the identical signed transaction is ever resubmitted; no second, different transaction is built or paid. `SettlementFlowTest` pins all three.

**Alternatives.** Keep the 006 wording (false for the default Blockfrost backend); change Java to fail in (b) (a TS divergence for no gain).

**Consequences.** With the default Blockfrost backend an evicted, already-included claim still ends in success. The misleading failure remains only for backends that cannot read evidence.

**Reverse.** Documentation only; the code mirrors TS either way.
