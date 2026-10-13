# 191 — WP10 phase 2 live check, and wallet contention between concurrent live runs

**Context.** The harness refuses every Cardano run without `SERVER_CARDANO_SELLER_MNEMONIC` (decision 174), so phase 2 was verified by running the components directly, as in phase 1. The orchestrator asked for:
- (a) Java servers × java-http × TS facilitator;
- (b) TS server × java-http × Java facilitator;
- (c) all-Java;
- (d) TS fetch × spring-mvc.

**Decision.**
- Components are started with their own `run.sh` (servers, Java facilitator) or the TS e2e entry points, with `e2e/.env` loaded without printing values.
- For (b), the phase-1 scratch TS server is used: the TS e2e server modules with Cardano registered without a Masumi seller. The real TS express server registers no Cardano scheme without the seller mnemonic.
- One more pass started the Java facilitator and both Java servers through the harness proxies (`GenericFacilitatorProxy`, `GenericServerProxy`, `GenericClientProxy`). It checked the ready lines, health, drift, a paid call and close.

**Finding: wallet contention, not an SDK bug.** The first two attempts of (a) on spring-mvc failed:
- `exact_cardano_settlement_failed` for default and script (transactions never on chain);
- then `invalid_exact_cardano_payload_nonce_not_on_chain` at verify.

The cause is concurrent use of the client wallet. At the same moment, another agent's Maven runs (WP11 example live runs) spent from the **same** client wallet: a 1.5 ADA payment, tx `ac719a97…`, landed at 18:15:22 UTC, one second before our settle. That wallet holds a single UTxO, so concurrent payers race for one input. After those runs stopped, every run passed on the first attempt.

**Consequences.**
- Live e2e runs from several agents or processes must not share `CLIENT_CARDANO_MNEMONIC`, or must be serialized.
- Decision 187 (WP11) documents back-to-back payments from one wallet. This is the concurrent case.

**Reverse.** n/a.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
