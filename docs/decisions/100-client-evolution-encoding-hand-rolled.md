# 100 — The Cardano client encodes transactions in Evolution's form with the module's CBOR writer, not with cardano-client-lib

**Context.** WP8's rules say to build with cardano-client-lib (CCL), and to stop and report if a Masumi piece cannot be built with it. The TS facilitator decodes the payment transaction with Evolution and **re-encodes** it before submitting (finding from the Go port). Any encoding that differs from Evolution's therefore changes the transaction id at the facilitator: the buyer's signature no longer matches, and a Java-built payment would fail against a TS facilitator. Evolution's form:
- `[body, witnessSet, true, null]`, with body keys ascending;
- inputs as a sorted tag-258 set;
- outputs without a datum in the legacy array form, and outputs with an inline datum in the map form;
- the vkey witnesses in a tag-258 set.

CCL's serializer decides the set tags and output forms itself, so it cannot be told to produce this form.

**Decision.** `PaymentTransactionBuilder` writes Evolution's form with the WP7 `Cbor.Writer`, and balances by porting the Go branch's `txbuilder.go` (nonce first, fee iteration, change min-UTxO, fold into fee). CCL is still used for keys, derivation and Ed25519 signing (`MnemonicAccounts`, `EdDSASigningProvider`). `EvolutionEncodingParityTest` proves the form: re-encoding five Evolution-built fixture transactions reproduces their bytes exactly. The Masumi lock datum comes from WP7's `MasumiDatum`, and `CardanoClientAcceptanceTest` checks it byte for byte against the TS datum.

The WP said "stop and report"; the user's standing instruction overrides that: take the recommended path, record it, continue. Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking; flagged for user sign-off in the final report.

**Alternatives.**
- CCL `QuickTxBuilder` (its encoding differs, so the payment breaks at a TS facilitator).
- Build with CCL and re-encode (two encoders to keep in agreement).

**Consequences.** About 400 lines of encoding and balancing that the module owns. Only the 4 body fields the client needs are written (B5).

**Reverse.** Replace `PaymentTransactionBuilder` with a CCL builder, after confirming the TS facilitator no longer re-encodes.
