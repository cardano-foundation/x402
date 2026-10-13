# 042 — Verification is a line-by-line port of TS; the lifted facilitator supplies patterns only

**Context.** The WP7 rules say to lift `service/verification/**`, `CardanoTransactionDecoder` and the Masumi classes from `cardano-x402-facilitator`. That code targets the same 2.26 behaviour but deliberately adds stricter, Java-only checks (payTo network tag, maxTxSize, payer-witness authorization, required signers, metadata validation, Plutus V1 inline-datum refusal, journaled payer) and different error codes. The plan's acceptance criterion is that Java decides exactly like TS 2.28 on every fixture.

**Decision.** `ExactCardanoFacilitatorScheme`, `MasumiVerifier`, `MasumiSchema`, `Phase1Checks`, `ScriptAddresses` and the decoder are ports of the TS sources, statement by statement, with TS's codes and messages. From the lifted code I kept the API patterns (CCL Ed25519, Blake2b, bech32; the bounded LZ decoder shape; the COSE check list), not its extra rules.

**Alternatives.** Lift verbatim and relax the extra rules one by one (higher risk of hidden divergence).

**Consequences.** Java accepts exactly what TS accepts. The stricter checks of the standalone facilitator are not in the SDK; they can be added by overriding `verify` (level 6 in plan §3a).

**Reverse.** Add the stricter checks behind an option.
