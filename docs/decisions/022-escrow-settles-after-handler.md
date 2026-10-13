# 022 — `PaymentFlow.ESCROW` settles after the handler too (WP2 fix)

**Context.** WP2 defined `ESCROW("escrow", verify=false, settleBefore=true, settleAfter=false)`. TS `PAYMENT_FLOWS.escrow` (`core/src/server/paymentFlow.ts:28-32`) is `settleBeforeHandler: true, settleAfterHandler: true`: deposit before the handler, charge after it. The WP2 value would have skipped the after-handler charge.

**Decision.** `ESCROW` now has `settleAfterHandler() == true`. Only the enum constant's flag changed; no signature changed, so the WP7 agent's jar-level contract is unaffected (Cardano uses the authorization flow only). `PaymentFlowTest#phasesMatchTsPaymentFlows` pins the tables.

**Alternatives.** None that keep TS parity.

**Consequences.** Multi-settle flows invoke settle hooks twice (before and after the handler), as in TS; hooks branch on `SettlePhase`.

**Reverse.** Not intended.
