# WP-7: Cardano server (incl. Masumi terms binding) and facilitator decide exactly like TS @x402/cardano 2.28.0 on every enumerated fixture
Tier: R3
Base: <git rev-parse HEAD at package start>
Check: `CardanoFacilitatorVectorsTest`, `MasumiTermsBindingTest`, `CardanoServerSchemeTest`, `MasumiDigestVectorsTest` pass; mutation log shows each of rules 1–9 caught

## Allowed files
- java/x402-mechanism-cardano/src/main/java/org/x402/mechanisms/cardano/*.java
- java/x402-mechanism-cardano/src/main/java/org/x402/mechanisms/cardano/chain/**
- java/x402-mechanism-cardano/src/main/java/org/x402/mechanisms/cardano/exact/server/**
- java/x402-mechanism-cardano/src/main/java/org/x402/mechanisms/cardano/exact/facilitator/**
- java/x402-mechanism-cardano/src/main/java/org/x402/mechanisms/cardano/exact/masumi/**
- java/x402-mechanism-cardano/src/main/java/org/x402/mechanisms/cardano/exact/script/**
- java/x402-mechanism-cardano/src/test/**
- java/x402-mechanism-cardano/pom.xml
- java/tools/ts-vectors/**
- docs/**

## Rules
- **Step 0, before any code, logged below:**
  - Diff the spec and the TS mechanism 2.26.0 → 2.28.0 and list every behaviour change, checked against `cardano-x402-facilitator/docs/upstream-compatibility.md`.
  - complexity-specialist reviews the invariant list before implementation: rules 1–9 (spec `specs/schemes/exact/scheme_exact_cardano.md:806-822`), Masumi (:824-850), script, and terms binding (:940-944).
- **Vector exporter** (`java/tools/ts-vectors/export-cardano.ts`): uses the TS test helpers (`typescript/packages/mechanisms/cardano/test/helpers/{buildSignedTx,stubs,masumi}.ts`) without editing them. Each fixture = {`now` (epoch ms that TS verified at), requirements, payload, chain-stub snapshot (UTxOs with owner/coin/assets, protocol params, slot config, tip), TS verify result}. Happy-path fixtures must stay valid when replayed with `Clock.fixed(now)`. Enumerated fixtures:
  1. default happy path
  2. wrong network
  3. no payTo output
  4. underpay
  5. wrong asset
  6. nonce not an input
  7. nonce already spent
  8. mint / withdrawal / cert present
  9. TTL beyond maxTimeoutSeconds
  10. output below min-UTxO
  11. l1Confirmations out of range / -1 without acceptMempool
  12. masumi happy path
  13. masumi tampered datum
  14. masumi bad COSE signature
  15. masumi unknown field (closed schema)
  16. script happy path
  17. script wrong datum
  18. script wrong address
- **Layout** mirrors Go branch `feat/cardano-go-implementation`: `org.x402.mechanisms.cardano` {constants, default assets, address, policy, limits}, `.exact.server`, `.exact.facilitator` {scheme, phase1, settlement-claim store SPI + in-memory}, `.exact.masumi`, `.exact.script`.
- **Lift** from `/Users/thkammer/Documents/dev/cardano/java/cardano-x402-facilitator`:
  - `service/verification/**` (minus `DefaultTransferVerifier`) and `CardanoTransactionDecoder` (drop `@Component`)
  - `Masumi{Digests,Cose,Datum,Blueprint,Identifier,Schema}`, `ScriptAddress`, `CardanoPolicies`, `Phase1Validator`
  - the chain port interfaces
  - Remove Lombok/Spring/JPA; down-port Java 21 features to 17.
- **2.28 facilitator behaviour:**
  - always broadcasts; no submission modes
  - `l1Confirmations` -1..20, default 1; acceptMempool default false
  - `settlement_pending` with `extra.transactionId`
  - 75 s confirmation wait, 5 s poll; a retry never rebroadcasts while its claim is retained
  - closed Masumi schema; termsDigest is Masumi-only
- **Server:**
  - `parsePrice`: AssetAmount passthrough with canonical lowercase asset; Money → USDM default-asset table; preview has none
  - `getAssetDecimals` (TS :243); `enhancePaymentRequirements` copies only `areFeesSponsored`
  - Masumi quote issuer (CIP-8 via `CardanoSellerSigner`) as `PaymentRequiredEnricher`, plus `storedQuoteFor` (TS :296-330)
- **Terms binding:** `schemeHooks().onAfterVerify` → `bindMasumiTerms` (TS `server/scheme.ts:116-121`, `:342-400`), using `MasumiTermsStorage` (SPI with atomic `updateTerms`; in-memory default) and aborting with `ERR_MASUMI_TERMS_UNKNOWN` / `ERR_MASUMI_TERMS_MISMATCH` / `ERR_DUPLICATE_SETTLEMENT`. `MasumiTermsBindingTest`:
  - a second tx for the same digest → `duplicate_settlement`
  - altered terms → mismatch
  - unknown terms → unknown
  - identical retry → allowed
  - two concurrent first claims → exactly one wins
- Chain backend SPI `CardanoChainBackend` (package `org.x402.mechanisms.cardano.chain`) with a Blockfrost implementation that includes the transaction-evidence read (TS `getTransactionEvidence`, `signer.ts:433-437`). Without it the advertised maximum would be 0 and every default policy (`l1Confirmations: 1`) would fail against the Java facilitator. Settlement-claim SPI `SettlementClaimStore` (in `.exact.facilitator`) mirroring TS `CardanoSettlementStore`: claim {txHash, ownerToken, termsDigest?}, results fresh / in-flight / submitted / rejected / terms-conflict / capacity-exceeded, plus `markSubmitted`, `markRejected`, `releaseClaim` (owner only, still in flight). The bounded in-memory default (4096 entries): `markSubmitted` clears in-flight (`settlementStore.ts:116`). Under capacity pressure the oldest evictable record goes; TS evicts any record no longer in flight (`:150-185`), but Java retains submitted and settled records until the TTL + 120 s grace (decision 126, a deviation from TS), and returns `capacity-exceeded` when nothing is evictable. A claim before broadcast is never evicted. Tests pin the behaviour after eviction of a submitted claim whose retention has passed: the retry gets a fresh claim and resubmits the identical transaction. (a) While still in the stub mempool, the node reports it as known → success after confirmation. (b) Once included: verify sees the nonce spent → failure for a payment that landed, with every backend (decision 013 supersedes 040, which recorded TS's evidence-based success here). In no case is a second, different transaction built or paid (decision 006). Both names are used by WP12's YAML wiring.
- `ExactCardanoFacilitatorScheme(chainBackend, signer?, options)`: a null signer means provider-only, and `getSigners` returns an empty list.
  - `options` mirror TS `ExactCardanoFacilitatorConfig`: `settlementStore`, `acceptMempool`, `confirmationTimeout` (75 s), `confirmationPoll` (5 s), `registryValidator` (`MasumiRegistryValidator`; without one, a non-empty `agentIdentifier` is rejected), `deploymentValidator` (`MasumiDeploymentValidator`), `clock`.
  - `CardanoChainBackend` methods mirror TS `FacilitatorCardanoSigner` (`signer.ts:330-450`): `getUtxo`, `getCurrentSlot`, `getProtocolParameters`, `submitTransaction`, `isDefinitiveSubmissionRejection`, `waitForConfirmation`, `evaluateTransaction`, `getTransactionEvidence`, `getAddresses`. A test verifies with protocol parameters supplied by a replacement backend.
- **Clock:** the facilitator, Masumi verification and quote issuer take a `java.time.Clock` (default `Clock.systemUTC()`). The vector tests pin it to each fixture's `now`.
- **`CardanoSellerSigner`** (interface + mnemonic-backed default) lives in `org.x402.mechanisms.cardano.exact.server` and is owned by this package.
- **Mutation check:** disable each of rules 1–9 individually; at least one test must fail for each; log the results.

## Proof commands
- red-first: ~/.claude/bin/red-first.sh <Base> --setup 'mvn -q -f java/pom.xml install -DskipTests' java/x402-mechanism-cardano/src/test/java/org/x402/mechanisms/cardano/exact/facilitator/CardanoFacilitatorVectorsTest.java java/x402-mechanism-cardano/src/test/java/org/x402/mechanisms/cardano/exact/server/MasumiTermsBindingTest.java java/x402-mechanism-cardano/src/test/java/org/x402/mechanisms/cardano/exact/server/CardanoServerSchemeTest.java java/x402-mechanism-cardano/src/test/java/org/x402/mechanisms/cardano/exact/masumi/MasumiDigestVectorsTest.java -- mvn -f java/pom.xml -pl x402-mechanism-cardano test
- green: `mvn -B -f java/pom.xml -pl x402-mechanism-cardano -am verify -Pcoverage checkstyle:check spotbugs:check`
- scope: ~/.claude/bin/check-scope.sh docs/work/wp-7-cardano-server-facilitator.md
- review: complexity-specialist on invariants (before code) and on the diff; user runs `/codex:adversarial-review`

## Log

### 2026-10-12 — Base and Step 0 (before any code)

Base: `f8f83309706b14cc696962f0a002eeeb66c3dc26` (no checkpoint commits, decision 001; WP7 files are working-tree changes).

#### Step 0a — TS / spec delta 2.26.0 → 2.28.0

Compared commit `6323ec74` (the published 2.26.0 that `cardano-x402-facilitator/docs/upstream-compatibility.md` pins) with HEAD:

- `typescript/packages/mechanisms/cardano/src/**`: **no change**. Only `CHANGELOG.md`, `package.json` (version) and `tsup.config.ts` differ; 2.27/2.28 are dependency bumps.
- `specs/schemes/exact/scheme_exact_cardano.md`: **no change**.
- `@x402/core`: one change, `x402HTTPResourceServer.ts` route matching on escaped + decoded paths (#3542). Not Cardano behaviour (WP4).

So the behaviour to port is TS at HEAD. The real delta is between the **lifted Java facilitator** (which already claims the "current behavior" column of its compatibility doc) and TS. Differences found by reading both, each resolved toward TS:

| # | Lifted Java facilitator | TS 2.28 (ported) |
|---|---|---|
| 1 | Durable JDBC journal, SettlementService/Reconciler, Spring/JPA | `CardanoSettlementStore` SPI + bounded in-memory default (decision 006) |
| 2 | Uncertain submit outcome → `settlement_pending` | throw → evidence lookup; landed → resume; definitive → `definitively_rejected`; else `exact_cardano_settlement_failed` with the claim retained (marked submitted) |
| 3 | TTL required for every method | TTL optional for `default`/`script`, checked when present; Masumi requires it |
| 4 | Extra checks: payTo network tag, maxTxSize, payer-witness authorization, required signers, script-locked inputs, metadata validation, Plutus V1 inline datum refusal | not in TS verify; not ported |
| 5 | Tri-state `UtxoLookup` | `getUtxo` snapshot `{exists, address, coin, assets, paymentKeyHash}`; provider failure throws |
| 6 | Aiken native binding for apply-params | pure-Java bit-level flat application (port of the Go branch `script/flat.go`), no native library (decision 043) |
| 7 | JCS via the `erdtman` library | in-module RFC 8785 with ECMAScript number formatting (decision 044) |
| 8 | COSE Sig_structure over the original protected bytes | TS (Evolution) re-encodes the decoded protected header map (definite, minimal, original order) — ported |
| 9 | Java-only error codes (`PAYER_NOT_WITNESS`, ...) | TS `constants.ts` codes only |
| 10 | Evidence before verify ignored; `verifyBroadcast` with a journaled payer | `acceptedByLedger = alreadyBroadcast` only (decision 013; TS also accepts `evidence != unknown`); payer = nonce snapshot owner |

#### Step 0b — invariant list (reviewed adversarially before coding; WP7 is its own complexity-specialist)

Verify (TS `exact/facilitator/scheme.ts:646-1077`, spec :806-822). Each line: rule → check → error code.

- **V0 envelope**: `x402Version == 2`; `accepted.scheme == requirements.scheme == exact`; normalized `accepted.network == requirements.network`; network is mainnet/preprod/preview (CIP-34 aliases normalized); `amount` `^[1-9][0-9]*$` and canonical lowercase `asset` → `invalid_exact_cardano_requirements`; payload has non-empty `transaction` (≤ 64 KiB canonical padded base64) and `nonce` → `invalid_exact_cardano_payload`; policy is the closed object `{l1Confirmations: int -1..20}`, default 1 → `..._requirements_policy`; nonce `^[0-9a-fA-F]{64}#\d+$` → `nonce_invalid`; tx decodes → `transaction_decode_failed`; ≤ 256 inputs → `phase1_invalid`.
- **R1 network**: body `network_id`, when present, is 1 (mainnet) / 0 (testnets) → `network_id_mismatch`. Absent is allowed; R2's exact bech32 equality enforces the network tag.
- **Witnesses**: no vkey/bootstrap and no script witness → `unsigned`; every vkey witness Ed25519-verifies over blake2b-256(raw body bytes) → `invalid_signature`.
- **R5a**: inputs unique (case-insensitive) → `phase1_invalid`; nonce is an input → `nonce_not_in_inputs`; `is_valid == false` → `phase2_invalid`.
- **Evidence gate**: `acceptedByLedger = alreadyBroadcast` (settle's resume of its own retained claim only). Decision 013 (security divergence from TS, which also accepts `evidence(txHash).status != unknown`): public verify always enforces the TTL window and unspent inputs, and answers `duplicate_settlement` for any transaction the claim store holds in any state.
- **R7**: only when TTL or validity start is present: current slot from the backend (error → `chain_lookup_failed`); `ttl <= current` and not accepted → `ttl_expired`; `slotMs(ttl) > slotMs(current) + maxTimeoutSeconds*1000` → `ttl_too_far` (also after acceptance); `validityStart > current` → `not_yet_valid`. Slot→ms through the network's slot config in exact integer arithmetic.
- **R5b**: every input looked up (error → `chain_lookup_failed`); payer = nonce snapshot owner; not accepted: nonce `!exists` → `nonce_not_on_chain`, any input `!exists` → `input_not_available`; empty payer → `nonce_not_on_chain`.
- **Protocol parameters** read when the backend offers them (error → `chain_lookup_failed`).
- **R6** (not accepted only): balance-changing body field (`mint`, `withdrawals`, `certificates`, `proposalProcedures`, `donation`) without a complete phase-1 validator → `phase1_invalid`; else value conservation over snapshot values (missing coin → `input_value_unavailable`, mismatch → `value_not_conserved`, zero quantities ignored); with parameters `fee >= minFeeB + minFeeA * |tx|` → `fee_below_minimum`; an optional complete validator that throws → `phase1_invalid`.
- **R2/R3/R4/R8**: outputs in order; address must equal `payTo` exactly; the first one carrying `>= amount` of the asset (lovelace = coin, else the lowercase unit) is the payment output: R8 `coin >= (160 + |output|) * coinsPerUtxoByte` when parameters exist → `min_utxo_insufficient`; then method checks; then the optional dry-run (not accepted; error → `chain_lookup_failed`); then `l1Confirmations > 0` without evidence capability → `evidence_unavailable`; else valid with payer. No qualifying output: none at payTo → `recipient_mismatch`; none with the asset → `asset_mismatch`; else `amount_insufficient`.
- **Method** from canonical `requirements.extra.assetTransferMethod` (never `accepted`); unknown → `unsupported_scheme`.
- **Script**: `scriptHash` or `script` required; `payTo`'s payment credential is a script hash equal to the hash derived from `script.code` + parameters (JS object order: integer-like keys ascending, then insertion order) or from `scriptHash` → `script_address_mismatch`. The datum is **not** verified (spec: MUST NOT be expected; TS parity).
- **Masumi** (spec :824-850): closed schema → `masumi_schema`; deadline intervals 5/15/15 min → `masumi_deadline`; part digests + manifest digest → `masumi_commitment`; deployment (Preview has none) and derived escrow == payTo → `masumi_deployment`; COSE: key OKP/EdDSA/Ed25519 with 32-byte `x` and no `d`, Sign1 `hashed == false`, equal `kid` when both present, seller payment credential is a key hash, payload == termsDigest, protected `address` == seller address bytes, alg EdDSA, blake2b-224(pk) == seller key hash, Ed25519 over the Sig_structure → `masumi_seller_signature`; a custom deployment needs validator approval → `masumi_deployment`; non-empty `agentIdentifier`: registry policy prefix, a validator, a resource, validator approval → `masumi_agent_identifier`; identifier decodes and every segment matches → `masumi_identifier`; exactly one escrow output → `masumi_escrow_output_count`; inline datum → `masumi_datum_missing`; no reference script → `masumi_reference_script`; datum = 19-field `Constr 0` → `masumi_datum_invalid`; datum invariants (FundsLocked, empty result hash, zero cooldowns, no script/pointer address forms, reference signature ≥ 16 bytes, no address equals the escrow, payout targets differ) → `masumi_datum_invalid` / intervals → `masumi_deadline`; TTL present and `slotMs(ttl) <= payByTime` → `masumi_deadline`; buyer payment credential == payer's and witnessed → `masumi_datum_mismatch`; seller, seller return address, byte fields, time fields → `masumi_datum_mismatch`; collateral 0 or ≥ 1,435,230 and `coin == requestedLovelace + collateral` → `masumi_collateral`; native token exact and exactly the requested asset set → `masumi_asset`; post-result min-UTxO when parameters exist → `masumi_min_utxo`.

Settle (TS `scheme.ts:320-515`, `:1153-1290`):

- **S1** decode payload, tx and policy first; failure → that code with `transaction: ""`.
- **S2** claim `{txHash (canonical body hash), ownerToken (16 random bytes), termsDigest (Masumi, when the schema validates)}` atomically **before any chain lookup**: `capacity-exceeded` → `exact_cardano_settlement_failed`; `terms-conflict` → `duplicate_settlement`; `rejected` → `definitively_rejected`; `in-flight` → `duplicate_settlement`.
- **S3 no resubmission while claimed**: `submitted` → `verifyBroadcast` (pre-broadcast checks skipped; payTo/amount/asset/method still checked); `chain_lookup_failed` / `nonce_not_on_chain` → `settlement_pending`; another failure → that failure; else await evidence and answer, **never calling submit**.
- **S4 fresh**: `verify()` (overridable) fails → release the claim → failure. Submit; a hash mismatch is an error after broadcast. Success → `markSubmitted`.
- **S5 submit threw**: with evidence capability look it up; `status != unknown` or a lookup error → landed → `markSubmitted`, await, answer. Not landed: definitive classifier → `markRejected` + `definitively_rejected`; else `markSubmitted` (claim retained) + `exact_cardano_settlement_failed` with the joined cause chain.
- **S6 evidence after a fresh submit**: `acceptMempool and required == -1` → the submitter's own status; evidence capability → poll (unknown → mempool/-1); else the submitter's status.
- **S7 response**: unknown → resumed and validity window closed (TTL + 120 s grace; slot lookup error = not closed) → `exact_cardano_settlement_failed` + `extra.status = expired`, else pending; mempool → success only with `acceptMempool` and `-1 >= required`, else pending with evidence capability, else `settlement_not_confirmed`; confirmed below required → pending; else success with `{status, confirmations}`. Pending = `settlement_pending`, `transaction` = txHash, `extra = {...evidence, status: pending, transactionId}`.
- **S8 wait**: poll every `confirmationPoll` (5 s) until `confirmationTimeout` (75 s), provider errors keep the strongest result; the Java loop never spins on a fixed `Clock` (decision 047).
- **/supported**: `assetTransferMethods [default, masumi, script]`, `areFeesSponsored false`, `l1Confirmations {minimum: acceptMempool ? -1 : 0, maximum: evidence capability ? 20 : 0}`; signers = signer addresses, empty when provider-only.

Claim store (TS `settlementStore.ts`, decision 006):

- **C1** atomic claim of tx + optional terms, no partial binding on failure; terms bound to another tx → `terms-conflict`; existing tx with different terms → `terms-conflict`.
- **C2** `markSubmitted` / `markRejected` owner-only; `markSubmitted` clears in-flight (`:116`).
- **C3** `releaseClaim` owner-only and only while in flight; drops its own terms binding too.
- **C4** capacity 4096 combined (tx + terms entries). Eviction removes the oldest evictable record plus its terms binding. Evictable means rejected, or submitted/settled past its `retainUntilMs` = TTL + 120 s grace. This deviates from TS, which evicts any record not in flight (decision 126). Nothing evictable → `capacity-exceeded`. A claim before broadcast is never evicted.
- **C5 after eviction of a submitted claim** a retry gets `fresh`, re-verifies and resubmits the **identical signed bytes** (same hash). Outcomes: (a) still in the stub mempool → node reports it known → success after confirmation; (b) already included → verify sees the nonce spent → `nonce_not_on_chain`, a failure for a payment that landed, with every backend (decision 013 supersedes 040, which recorded TS's evidence-based success). Never a second, different transaction. A transaction reported settled is terminal: a later settle answers `duplicate_settlement`.

Server and terms binding (TS `server/scheme.ts`, `masumiIssuer.ts`, spec :940-944):

- **B1** `onAfterVerify` acts only on a valid result whose `accepted.extra.assetTransferMethod == masumi`; digest from `accepted`; txHash from decoding the payload transaction (failure → abort `invalid_exact_cardano_payload`).
- **B2** inside one atomic `updateTerms`: unknown digest → abort `masumi_terms_unknown`; stored requirements not deep-equal (canonical JSON) to `accepted` → abort `masumi_terms_mismatch`; the first claim binds the txHash; bound to a different tx → abort `duplicate_settlement`; same tx → proceed (paid retry).
- **B3** every served Masumi quote is stored under its digest, first write wins; a stored quote is re-served for a paid retry only when scheme/network/payTo/amount/asset/maxTimeoutSeconds and every template `extra` key still match.
- **B4** `enhancePaymentRequirements` copies only a boolean `areFeesSponsored`; checks the facilitator advertisement all-or-nothing (methods, l1 range, Masumi schema).
- **B5** `parsePrice`: AssetAmount needs an asset; amount/asset canonical (TS validates, it does not lowercase); Money → custom parsers, then USDM (Preview has none → error).

Adversarial review notes (checked against TS before writing code):

1. Decision 006 outcome (b) does not hold for TS with an evidence-capable backend (C5). Recorded as decision 040; tests pin the real TS behaviour for both backend kinds.
2. R8 judges the **first** qualifying output; a later, larger output does not rescue an undersized first one. Ported as is.
3. `ttl_too_far` still applies after ledger acceptance; `ttl_expired` does not.
4. Superseded by decisions 013 and 125: public verify reads the claim state (`submitted` → resume verification; `in-flight` / `settled` / `rejected` → `duplicate_settlement`; store failure → invalid) and never passes a fresh transaction through evidence; only settle writes the store.
5. The Masumi `termsDigest` is claimed in **both** the facilitator store (advisory, same atomic claim) and the resource server's terms storage (authoritative binding).
6. Min-UTxO and Masumi datum sizes: TS measures Evolution's re-encoding, Java measures the wire bytes (what the ledger measures). Identical for Evolution/Aiken-encoded transactions; deviation recorded (decision 041).
7. TS's facilitator never calls `waitForConfirmation`; it stays on the SPI for parity only.

### 2026-10-12 — Vectors exported, tests written first

- Exporter `java/tools/ts-vectors/export-cardano.ts` ran with the workspace tsx (`typescript/node_modules/.bin/tsx`; the cardano package has no tsx of its own, decision 051): wrote `cardano-facilitator.json` (40 fixtures: the 18 enumerated ones plus variants, 7 of them settle fixtures, and the `/supported` matrix), `cardano-server.json` (parsePrice, getAssetDecimals, enhancePaymentRequirements) and `masumi-digests.json` (JCS, part/manifest/terms digests, COSE, identifiers, escrow derivation, script hashes, a deterministic seller signature and quote, a lock datum). No TS file edited.
- red-first (manual, decision 001): `mvn -B -pl x402-mechanism-cardano test` → EXIT=1, BUILD FAILURE at testCompile, 188 × "cannot find symbol" (no production code yet) for CardanoFacilitatorVectorsTest, SettlementFlowTest, InMemorySettlementClaimStoreTest, MasumiTermsBindingTest, CardanoServerSchemeTest, MasumiDigestVectorsTest, InMemoryMasumiTermsStorageTest, BlockfrostChainBackendTest.

### 2026-10-12 — Implementation, green, mutation check

- First full test run after implementation: 119/120 green. The failure was a test setup defect (no-evidence backend with the default `l1Confirmations: 1`, refused in verify before the behaviour under test); setup corrected, assertions unchanged (decision 054). The exporter was re-run once to drop an array-shaped advertisement case Java's `SupportedKind` cannot represent (decision 053); fixtures were regenerated (new random keys, new `now`).
- Tests added **after** the implementation for branch coverage and edge-case evidence (not red-first; they passed or were fixed against TS behaviour on first run): `VerifyBranchesTest` (13), `MasumiVerifierTest` (8), `MasumiSchemaTest` (5), `MasumiPrimitivesTest` (6), `CodecBranchesTest` (6), `ScriptBranchesTest` (4), `ServerBranchesTest` (3), `BlockfrostBranchesTest` (4). While writing them one more TS parity gap surfaced and was fixed in code: the decoder accepted 3-element (pre-Alonzo) transaction envelopes, Evolution only decodes the 4-element form; now refused as `transaction_decode_failed`.
- Core: the orchestrator installed a new `x402-core` jar mid-package (WP3/WP4); the final run below is against it. Decision 049 updated (core now fills `PaymentRequiredContext.paymentPayload`).
- Green: `cd java && mvn -B -pl x402-mechanism-cardano verify -Pcoverage checkstyle:check spotbugs:check` → EXIT=0, BUILD SUCCESS. Tests run: 169, Failures: 0, Errors: 0, Skipped: 0. JaCoCo: instructions 17444/17855 = 0.977 (gate 0.85), branches 2077/2399 = 0.866 (gate 0.75). Checkstyle: 0 violations. SpotBugs: 0 bugs (one `HSC_HUGE_SHARED_STRING_CONSTANT` on the validator constant fixed by an accessor).
- Scope (manual, decision 001): all WP7 changes are under `java/x402-mechanism-cardano/**` (main code in the allowed packages: top level, `chain`, `exact.server`, `exact.facilitator`, `exact.masumi`, `exact.script`; tests; module pom: WireMock test dependency only), `java/tools/ts-vectors/export-cardano.ts`, this file, `docs/decisions/040-055` and README rows.

Mutation check (each rule disabled alone in `ExactCardanoFacilitatorScheme` / `CardanoPolicies`, full module test suite, source restored; script `mutate.py` in the session scratchpad):

| Rule | Mutation | Result | Failing tests (first) |
|---|---|---|---|
| 1 network | body `network_id` check off | 1 failure | `VerifyBranchesTest.bodyRulesRejectWithTypeScriptReasons` (the TS fixtures carry no `network_id`; their wrong-network cases are caught by rule 2's address check) |
| 2 recipient | payTo address match off | 6 failures | `CardanoFacilitatorVectorsTest` (03, 02b, 15b, …), `SettlementFlowTest`, `VerifyBranchesTest` |
| 3 amount | `available < amount` skip off | 3 failures | `CardanoFacilitatorVectorsTest` (04), `SettlementFlowTest`, `VerifyBranchesTest` |
| 4 asset | missing asset falls back to coin | 1 failure | `CardanoFacilitatorVectorsTest` (05) |
| 5a nonce is an input | check off | 1 failure | `CardanoFacilitatorVectorsTest` (06) |
| 5b inputs unspent | check off | 3 failures | `CardanoFacilitatorVectorsTest` (07), `SettlementFlowTest.afterEvictionWithoutEvidence…`, `VerifyBranchesTest` |
| 6 phase-1 | whole block off | 6 failures | `CardanoFacilitatorVectorsTest` (08, 06b, 06c, 06d, protocol-parameter test), `VerifyBranchesTest` |
| 7 TTL | TTL / validity block off | 5 failures | `CardanoFacilitatorVectorsTest` (09, 09b), `VerifyBranchesTest` |
| 8 min-UTxO | check off | 1 failure | `CardanoFacilitatorVectorsTest` (10) |
| 9a evidence threshold | settle success below the policy | 2 failures | `CardanoFacilitatorVectorsTest` (11f), `SettlementFlowTest.pendingRetry…` |
| 9b policy range | `-1..20` range off | 3 failures | `CardanoFacilitatorVectorsTest` (11a), `CodecBranchesTest`, `MasumiSchemaTest` |

Every rule is caught by at least one test.

Open items for the orchestrator / later packages:
- Plan §3a ("Duplicate guard" row) and decision 006 still state the uncorrected outcome (b); decision 040 and this file's Rules carry the correction. The plan is not in WP7's file ownership.
- WP8 can reuse `Cbor`, `PlutusData`, `CardanoTransactionDecoder`, `CardanoAddresses`, `MnemonicAccounts`, `MasumiSchema`, `MasumiVerifier.verifyAuthorization` (with `requireAllPartContent` and the horizon), `MasumiDatum.build`, `MasumiConstants.collateralLovelace`, `ScriptDatum`, `DefaultAssets`.
- WP12/WP13: `ExactCardanoFacilitatorScheme(backend, CardanoFacilitatorSigner.fromMnemonic(...) | null, ExactCardanoFacilitatorOptions)`, `BlockfrostChainBackend(Config)`, `ExactCardanoServerScheme(ExactCardanoServerConfig{masumiStorage, masumi: MasumiIssuerConfig})`, `CardanoSellerSigner.fromMnemonic`.

### 2026-10-12 — Security fix: replay guard (decision 013) and the independent review findings (decisions 120–124)

Interrupting WP8 at a green point (WP8 module gate EXIT=0, 193 tests), on the coordinator's priority request.

**Decision 013 (replay guard).**
- red-first (manual, decision 001): new `ReplayGuardTest` (6 tests). The first run failed at testCompile (`cannot find symbol: SETTLED`). After adding only the enum constant, `mvn -B -pl x402-mechanism-cardano test -Dtest=ReplayGuardTest` → Tests run: 6, Failures: 6. Each of the coordinator's cases (a)–(e) was red, plus "ledger evidence alone never validates a public verify".
- Implementation:
  - Public `verify` checks `SettlementClaimStore.isClaimed(txHash)` first → `duplicate_settlement`. Then `verifyPayment` (rules 1–9, `acceptedByLedger = alreadyBroadcast` only, so never true in public verify).
  - `settle` runs `verifyPayment` for a fresh claim. The `SETTLED` claim result → `duplicate_settlement`. Every success passes through `markSettled`; a lost race → `duplicate_settlement`.
  - Store semantics: decision 124.
- One test added after the implementation (not red-first; it passed first time): `ReplayGuardTest.afterEvictionAMempoolRetryResubmitsIdenticallyAndConfirmsOnItsRetainedClaim`. It pins outcome (a) under 013.

**Deliberate requirement change (decision 013).** These existing assertions encoded TS's replay-accepting behaviour and were changed; no others were.

| Test | Assertion | Old | New |
|---|---|---|---|
| `CardanoFacilitatorVectorsTest.javaDecidesLikeTypeScript[07c-already-on-ledger]` | expected verify result (TS fixture unchanged; the expectation is overridden in the test with a comment) | `{isValid: true, payer}` | `{isValid: false, invalidReason: invalid_exact_cardano_payload_nonce_not_on_chain, payer}` |
| `SettlementFlowTest.afterEvictionAMempoolTransactionIsResubmittedIdenticallyAndConfirms` → renamed `…IdenticallyButASecondEvictionAfterInclusionFails` | final settle after inclusion and a second eviction | `done.success()` is true | `done.errorReason()` = `invalid_exact_cardano_payload_nonce_not_on_chain` (the submission-count assertion `>= 2` is unchanged) |
| `SettlementFlowTest.afterEvictionAnIncludedTransactionIsRecognisedByEvidenceAndSucceeds` → renamed `afterEvictionAnIncludedTransactionFailsWithTheNonceSpent` | retry after eviction of an included transaction | `retry.success()` true; identical bytes submitted 2× | `retry.success()` false, `errorReason` = `invalid_exact_cardano_payload_nonce_not_on_chain`; submitted 1× (refused before resubmission); `retry.transaction()` = hash unchanged |

**Independent review findings.**
- red-first (manual): new `ReviewHardeningTest` (6) and `MasumiTermsStorageFailureTest` (1). `mvn -B -pl x402-mechanism-cardano test -Dtest='ReviewHardeningTest,MasumiTermsStorageFailureTest'` → EXIT=1, Tests run: 7, Failures: 4, Errors: 2. Only the untampered baseline passed.
  - The three duplicate-key transactions verified **valid** (`invalidReason` null), which confirms finding 1.
  - The `final` check failed.
  - Null evidence threw a NullPointerException.
  - The storage failure propagated (`IllegalStateException`) instead of aborting.
- Fixes:
  - Finding 1 BLOCKING, duplicate CBOR keys → decode failure: decision 120.
  - Finding 2, final entry points; `verifyBroadcast` private: decision 121.
  - Finding 4, terms storage failure → abort `masumi_terms_storage_unavailable`: decision 122.
  - Finding 5, null evidence → unknown: decision 123.
  - Optional Ed25519 small-order/non-canonical rejection: skipped (not trivial; it needs ledger-exact point checks).
- Finding 3, process:
  - (a) The 49 post-implementation coverage tests listed in the "Implementation, green, mutation check" entry (`VerifyBranchesTest` 13, `MasumiVerifierTest` 8, `MasumiSchemaTest` 5, `MasumiPrimitivesTest` 6, `CodecBranchesTest` 6, `ScriptBranchesTest` 4, `ServerBranchesTest` 3, `BlockfrostBranchesTest` 4) reference classes absent at Base. They cannot compile at Base, so they are red at Base per decision 001; they were not run red individually.
  - (b) Decisions 053 and 054 now carry the standing-instruction sign-off line.

**Mutation re-check (rule 5 and 013)** — `mutate5.py` in the session scratchpad, each mutation alone, full module suite, source restored:

| Mutation | Result | Failing tests (first) |
|---|---|---|
| 5a nonce is an input: check off | 1 failure | `CardanoFacilitatorVectorsTest` (06) |
| 5b inputs unspent: check off | 8 failures | `CardanoFacilitatorVectorsTest`, `ReplayGuardTest.afterEviction…`, `ReplayGuardTest.ledgerEvidenceAlone…`, `SettlementFlowTest` (3) |
| 013a TS evidence acceptance restored in verify | 6 failures | `CardanoFacilitatorVectorsTest` (07c), `ReplayGuardTest` (2), `SettlementFlowTest` (2), `VerifyBranchesTest.providerFailures…` |
| 013b `isClaimed` check off | 2 failures | `ReplayGuardTest.aPaymentClaimedElsewhereDoesNotVerify`, `.aSettledPaymentNoLongerVerifies` |
| 013c `markSettled` gate off | 2 failures | `ReplayGuardTest.aSettledPaymentCannotBeSettledAgain`, `.theLegitimatePendingRetryStillSucceedsExactlyOnce` |

**Green:**
- `cd java && mvn -B -pl x402-mechanism-cardano verify -Pcoverage checkstyle:check spotbugs:check` → EXIT=0, BUILD SUCCESS.
- Tests run: 207, Failures: 0, Errors: 0, Skipped: 0. This includes the WP8 tests written so far.
- JaCoCo: instructions 19866/20394 = 0.974; branches 2281/2644 = 0.863.
- Checkstyle: 0 violations. SpotBugs: 0 bugs.

**Docs:**
- Rules above updated (C5, row 10, evidence gate, open-question 4).
- Decision 040 marked as superseded in part by 013.
- Plan §3a "Duplicate guard" sentence updated.
- Not edited (outside the allowance): the plan §3a level-4 row still lists the old claim results and methods; it should add `settled`, `markSettled` and `isClaimed` (decision 124).

### 2026-10-12 — Second R3 review: the 013 amendment (decisions 125–127)

- red-first (manual, decision 001): new `ReplayGuardAmendmentTest` (8 tests).
  - First run: testCompile failure (`cannot find symbol: SettlementClaimState`, 8×).
  - I then added only the API skeleton, which preserves the existing behaviour: the enum; abstract `claimState` replacing `isClaimed`, with the scheme using `claimState(...).isPresent()`; the store's `(int, Clock)` constructor; the 4-field `SettlementClaim`.
  - Second run, `-Dtest=ReplayGuardAmendmentTest`: Tests run: 8, Failures: 6, Errors: 1.
  - Red: the client paid retry after pending; the concurrent replay during `submitted`; the failing store (verify fell through); the mempool-settled replay after eviction; the submitted claim surviving pressure; the store retention rules; null status (NPE).
  - Green at the skeleton (a regression guard for kept behaviour): `anInFlightOrRejectedClaimStillRefusesPublicVerify`.
- Implementation:
  - Decision 125: public verify by claim state, with `submitted` → `verifyBroadcast`, and a store failure → `exact_cardano_settlement_failed` / "settlement store unavailable".
  - Decision 126: retention until TTL + 120 s grace; the claim carries `retainUntilMs`; the store has a Clock, and the options' default store uses the options' clock.
  - Decision 127: a null evidence status is unknown.
- Decisions 006 and 124 now point to the amendment and to 125/126. The rules above (store paragraph, C4, open question 4) and the plan §3a "Duplicate guard" row and level-4 SPI sentence are updated.

**Deliberate requirement change (013 amendment; decisions 125, 126).** No other assertion changed.

| Test | Change | Old | New |
|---|---|---|---|
| `ReplayGuardTest.aPaymentClaimedElsewhereDoesNotVerify` | verify after `markSubmitted` by another worker | `invalidReason` = `duplicate_settlement` | `isValid()` true (submitted claims resume, 125). The in-flight half is unchanged. |
| `InMemorySettlementClaimStoreTest.evictsTheOldestSettledClaimOnceFull` | setup only: the claims for `first` and `second` | 3-field claims (no expiry) | `retainUntilMs = 0` (retention elapsed); assertions unchanged |
| `InMemorySettlementClaimStoreTest.dropsTheTermsBindingWithTheEvictedClaim` | setup only: the claims for `lock` and `other` | 3-field claims | `retainUntilMs = 0`; assertions unchanged |
| `ReplayGuardTest` (2 eviction tests), `SettlementFlowTest` (3 eviction tests) | setup only: store constructor | `new InMemorySettlementClaimStore(1)` (system clock) | `new InMemorySettlementClaimStore(1, AFTER_RETENTION)`; assertions unchanged |

The last row matters for determinism. With the system clock, these tests passed only because the real time already lies past the fixtures' TTL + grace. That held about 70 minutes after export, but would not hold right after a re-export. The scenarios they pin (eviction of a broadcast record) now happen only after retention.

**Mutation check** (`mutate125.py`, each alone, full suite, source restored):

| Mutation | Result | Failing tests |
|---|---|---|
| 125a `submitted` refused by public verify (as before) | 3 failures | `ReplayGuardAmendmentTest.theClientsPaidRetry…`, `.concurrentReplays…`, `ReplayGuardTest.aPaymentClaimedElsewhere…` |
| 125b store failure falls through to `verifyPayment` | 1 failure | `ReplayGuardAmendmentTest.aFailingClaimStoreFailsPublicVerifyClosed` |
| 126 retention ignored (TS eviction) | 3 failures | `ReplayGuardAmendmentTest.aMempoolSettledPayment…`, `.aSubmittedClaimSurvives…`, `.storeRetentionRules` |
| 127 null status not mapped | 1 error | `ReplayGuardAmendmentTest.evidenceWithoutAStatusIsUnknown` |
| 5b inputs unspent off | 8 failures | `CardanoFacilitatorVectorsTest`, `ReplayGuardTest` (2), `SettlementFlowTest` (3), … |

**Process (finding 6).** Under decision 001 (no checkpoint commits), every test added after its implementation counts as red at Base by non-compilation: it references classes that do not exist at Base. That covers the 49 coverage tests above, `ReplayGuardTest.afterEvictionAMempoolRetry…`, and WP8's `ClientBranchesTest`.

**Green:**
- `cd java && mvn -B -pl x402-mechanism-cardano verify -Pcoverage checkstyle:check spotbugs:check` → EXIT=0, BUILD SUCCESS.
- Tests run: 215, Failures: 0, Errors: 0, Skipped: 0.
- "All coverage checks have been met". Checkstyle: 0 violations. SpotBugs: 0 bugs.
