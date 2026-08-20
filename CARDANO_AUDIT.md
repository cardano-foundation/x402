# Cardano x402 — Full Implementation Audit & Fix Plan

**Scope (full):** the TypeScript Cardano payment mechanism
(`typescript/packages/mechanisms/cardano` — client, server, facilitator, signer,
utils, constants, types, the Masumi `vested_pay` escrow support, and the script
method), the scheme spec (`specs/schemes/exact/scheme_exact_cardano.md`), the
package's tests and build config, and the e2e harness
(`e2e/` servers, clients, facilitator, CI wiring). All three
assetTransferMethods — **default** (address-to-address), **masumi**, and
**script** — are covered. Java/Python/Go Cardano ports were removed in a prior
commit, so TypeScript is the only live implementation.

**Method:** manual read of every source file + spec section; two multi-agent
audit rounds (13 audit dimensions, each finding adversarially re-verified by an
independent skeptic — 46 agents total); independent on-chain fact-checks (bech32
decoding, Masumi config/seed/migration cross-reference, CIP-69/ledger datum
rules, Evolution SDK source tracing, vitest glob and export-map checks).

**Verdict.** The cryptographic and parsing core is solid — datum encoding, the
facilitator's verification rules, transaction decoding, signature verification,
min-UTXO math, the collateral floor, the Masumi lock invariants, and script-hash
derivation are all correct at byte/field level, and the server scheme is in
places stricter than its EVM/SVM siblings. But there are **two critical
fund-strand bugs**, **two high-severity issues**, and a cluster of medium
spec/validation/CI gaps. None is a theft vector; the serious ones cause
**stranded or falsely-accepted** payments.

---

## Findings (severity-ranked)

| # | Sev | Area | Location | One-line |
|---|-----|------|----------|----------|
| **C1** | 🔴 Critical | Masumi constant | `exact/masumi/constants.ts:26` | Hardcoded escrow hash is stale → `masumiContractAddress()` returns a retired/void escrow → locked funds stranded |
| **C2** | 🔴 Critical | Script method | spec `:221-261` + `signer.ts:432` + `facilitator/scheme.ts:538` | Script method has **no datum mechanism**; client pays a datum-less output → funds permanently unspendable for any V1/V2 or datum-requiring validator |
| **H1** | 🟠 High | Client signer | `signer.ts:404` | Lovelace Masumi lock isn't sized to the post-result min-UTXO floor → locks under ~3.12 ADA are rejected |
| **H2** | 🟠 High | CI | `.github/workflows/e2e_tests.yml`, `e2e/scripts/ci-select-families.sh` | Cardano e2e is wired but **never runs in CI** (no cardano branch, no secrets) → regressions on real-value paths ship green |
| **M1** | 🟡 Medium | Spec ↔ code | `verify.ts:87` + spec 164/219/406 | Spec says `contractAddress` optional-with-default; code hard-requires it → spec-conformant server falsely rejected |
| **M2** | 🟡 Medium | Server scheme | `server/scheme.ts:61,71,126` | `parsePrice` never validates `amount`; a negative amount makes the facilitator's rule-3 (`available >= amount`) vacuous → conditional free-resource bypass |
| **M3** | 🟡 Medium | Client signer | `signer.ts:442` | Sub-min-UTXO lovelace payments are built/signed instead of rejected at build time (spec MUST) → opaque node failure |
| **M4** | 🟡 Medium | Network check | `constants.ts:143`, `client/scheme.ts:52`, `facilitator/scheme.ts:214` | No `payTo` network-tag check → mainnet address on a preprod request passes `verify()`, fails only at submit |
| **M5** | 🟡 Medium | Docs | `README.md:68-76` | README tells operators to **override `runMethodSpecificChecks`**, which silently drops Masumi/script verification |
| **M6** | 🟡 Medium | E2E harness | `e2e/test.ts:496`, `clients/*/index.ts` | A `requiresPayment` route that returns 200 with no 402 passes vacuously → paywall-bypass regressions go undetected |
| **M7** | 🟡 Medium | E2E docs | `e2e/README.md:191`, `express/index.ts:701` | Funding docs stale/contradictory; `masumi-usdm` needs non-faucet tUSDM |
| L1–L7 | 🔵 Low | various | see table below | defense-in-depth / robustness |
| I1–I11 | ⚪ Info | various | see table below | docs / clarity |

---

## C1 — 🔴 Critical: stale Masumi escrow script hash

**Location:** `exact/masumi/constants.ts:26`

```ts
const MASUMI_ESCROW_SCRIPT_HASH = "2025f0de96b0a8f2d29462a3b186cc480e22b14c0ace2490469ad305";
```

This hash does not match Masumi's deployed `vested_pay` v2 escrow. Decoding
Masumi's committed canonical addresses:

| Source | Address | Script hash |
|---|---|---|
| **x402 hardcoded** (`constants.ts:26`) | `addr_test1wqsztux7…` | `2025f0de…9ad305` |
| Masumi **V2** default (`payment-core/src/config.ts:412`) | `addr_test1wzs4e6wc…` / `addr1wxs4e6wc…` | **`a15ce9d8…5a3b14ad`** |
| Masumi **V1** default (`config.ts:404`) | `addr_test1wz7j4kmg2…` | `bd2adb68…` |
| Un-applied blueprint (`plutus.json`) | — | `2d6abca3…` |

The correct current V2 escrow hash is
**`a15ce9d82d2f67645fc624e2edac03c6f1c106d0ad1af5815a3b14ad`** (network-independent;
only the address header byte differs). It is proven canonical by Masumi's
`prisma/seed.ts:374-387` (asserts `getPaymentScriptV2(...)` equals the V2 default)
and the migration `20260704120000_repoint_retired_default_v2_sources`. x402's
`2025f0de…` matches none of these — Masumi's own sync classifier
(`warn-out-of-sync-v2-sources.spec.ts`) treats it as an `outdated_contract`. So
`masumiContractAddress()` builds an address over a hash **no live validator hashes
to** — a void/retired script with no spending path.

**Why it strands funds.** `verifyMasumiLock` only checks
`payTo === extra.contractAddress` (`verify.ts:87`) — it never cross-checks a real
deployed hash — so when both are the wrong value, verification passes and the
client locks funds into the void script. **Reachable in the project's own e2e
server:** `e2e/servers/express/index.ts` sets both `payTo` and `contractAddress`
to `masumiContractAddress(CARDANO_NETWORK)` for `/exact/cardano/masumi` (5 ADA)
and `/exact/cardano/masumi-usdm` (1 tUSDM). Run on preprod, that permanently
strands real value. The three tests that touch the address derive **both** sides
of every assertion from `masumiContractAddress()`, so they compare the broken
helper against itself and can never fail.

**Fix.**
1. Replace the constant with `a15ce9d82d2f67645fc624e2edac03c6f1c106d0ad1af5815a3b14ad`.
2. Replace the self-referential tests with a **pinning test** asserting the real
   deployed addresses (`addr_test1wzs4e6wc…` / `addr1wxs4e6wc…`); stronger, derive
   in-test by applying `[2, [3 admin key hashes], 420000]` to `plutus.json`
   `compiledCode` via `getPaymentScriptV2`.
3. Masumi has **no** canonical `preview` deployment — don't present
   `masumiContractAddress("cardano:preview")` as authoritative.
4. Root cause: a hardcoded deployment hash goes stale on redeploy (this bug is the
   proof). Treat the purchase-supplied `contractAddress` as authoritative and keep
   the helper strictly as a labeled convenience.

---

## C2 — 🔴 Critical: script method strands funds (no datum mechanism)

**Location:** spec `scheme_exact_cardano.md:221-261`; `signer.ts:432-436`;
`exact/facilitator/scheme.ts:538-549`; `types.ts:155-177`

The script `assetTransferMethod` provides **no way to attach a datum**.
`CardanoExtraScript` carries only `scriptHash` / `script` / `parameters`, and the
spec's Script schema matches — `parameters` are UPLC-applied to the script *code*
(changing its hash for address derivation), never attached to the output. The
reference client signer builds a datum only for masumi (`signer.ts:394-396,432-436`);
for a script payment it emits a **plain, datum-less** `payToAddress` output to the
script address.

Per Cardano ledger rules (confirmed against CIP-69 and the Plutus ledger-language
docs): a UTxO at a **PlutusV1/V2** script address with no datum is **permanently
unspendable** (phase-1 `UnspendableUTxONoDatumHash`; the script never even runs).
**PlutusV3** relaxes this — the datum is `Option`, so only a validator explicitly
written for the `None` case can spend it. `types.ts:131` advertises all three
versions.

The facilitator does not catch it: the script branch of `runMethodSpecificChecks`
(`scheme.ts:538-549`) only checks descriptor presence and `scriptAddressMatches`;
it never inspects the output's datum, even though `decodeCardanoTransaction`
already surfaces inline datums. The optional `evaluateTransaction` dry-run can't
help — a tx that merely *pays to* a script executes no script and has no
redeemers. So `verify()` returns `isValid:true`, `settle()` confirms, the server
grants access — and the payee can never collect and the payer can never reclaim.
**Real fund loss on every script-method payment to a datum-requiring validator.**

The e2e masks this: `/exact/cardano/script` uses an **always-succeeds PlutusV3**
fixture, one of the few scripts a datum-less output *is* spendable from — so the
happy path passes while the general case is broken.

**Fix.**
- **Spec:** add an explicit datum to the Script schema — `extra.datum` (CBOR hex
  or typed PlutusData) + `extra.datumKind: "inline" | "hash"` — and require the
  client to attach it (inline for V2/V3; datum-**hash** for V1) and the
  facilitator to verify the output's datum equals the declared value (mirroring
  `verifyMasumiLock`).
- **Facilitator (interim, do now):** in the script branch, reject when the `payTo`
  output has no datum — unconditionally for `plutusV1`/`plutusV2`, and for
  `plutusV3` unless the requirements explicitly opt into a no-datum script. (V1
  needs a datum *hash*, which `utils.ts` doesn't yet surface — extend the decoder.)
- **Client:** refuse to build a script payment with no datum (fail loudly instead
  of stranding), once `extra.datum` exists.

**Status (partially addressed).** The datum **mechanism** is now implemented:
`extra.datum` (CBOR hex, inline) is defined in `types.ts`, the client attaches it
to the `payTo` output (`signer.ts` + `exact/script/datum.ts`), and the spec/README
document it. This lets a server lock into a datum-requiring contract, closing the
"no way to attach a datum at all" root cause. **By design, the facilitator does
NOT verify the datum** (it is arbitrary and contract-specific — unverifiable in
general), so the residual risk is now the server's: a wrong or missing datum still
strands funds, and this is documented as the server's responsibility. Datum-hash
(PlutusV1) locking remains out of scope. The optional facilitator datum-*presence*
check (reject datum-less V1/V2 script outputs) was intentionally not added.

---

## H1 — 🟠 High: lovelace Masumi lock isn't sized to the facilitator's floor

**Location:** `signer.ts:404`

The min-UTXO top-up is gated `input.asset.toLowerCase() !== LOVELACE_ASSET`, so a
lovelace Masumi lock skips it and relies only on `autoMinUtxo` (which bumps to the
*ledger* min of the current empty-result datum). The facilitator (`verify.ts:173-181`)
requires the **post-result** floor — headroom for the 32-byte `result_hash` and
non-zero cooldowns the seller writes on `SubmitResult`. Reproduced: for the
367-byte lock datum at `coinsPerUtxoByte = 4310`, `autoMinUtxo` yields ~2.59 ADA
but the floor is **3,124,750 lovelace (~3.12 ADA)**. Every lovelace Masumi lock
whose `amount` is under ~3.12 ADA (the common 1–3 ADA micropayment) is rejected
with `…_masumi_min_utxo`. No funds lost (pre-submission), but unpayable with no
client-side workaround. (The e2e uses 5 ADA, so it doesn't surface there.)

**Fix.** Remove the lovelace exclusion; for lovelace set the lock coin to
`max(masumiMinUtxoLovelace(datumBytes, 0, coinsPerUtxoByte), amount + collateral)`.
Add a 2-ADA `verifyMasumiLock` → `ok:true` regression test.

---

## H2 — 🟠 High: Cardano e2e never runs in CI

**Location:** `.github/workflows/e2e_tests.yml:43-66,142-175`;
`e2e/scripts/ci-select-families.sh:51-85`

The e2e harness fully wires Cardano — express (default/masumi/masumi-usdm/script),
fastify/hono (default), next (proxy + withx402), axios + fetch clients, and the TS
facilitator all register it — but `ci-select-families.sh` has **no cardano
branch** and the workflow maps **no Cardano secrets** into the `.env`, so the
selector can never emit `cardano` and the scenarios are silently dropped
(`filters.ts:82-84` drops unselected families without error). A regression in tx
building, the Masumi lock, or settle confirmation passes unit tests and ships
green because the real-value path is never exercised end-to-end.

**Fix.** Add a `cardano` branch to `ci-select-families.sh`
(`all_set SERVER_CARDANO_ADDRESS CLIENT_CARDANO_MNEMONIC BLOCKFROST_PROJECT_ID`),
map those secrets in the workflow, write them into the generated `.env`, and log
which families were excluded and why.

---

## Medium findings (concise)

- **M1 — `contractAddress` required vs spec-optional** (`verify.ts:87`; spec 164/219/406).
  Code rejects when `contractAddress` is absent; spec says default to the canonical
  address. A spec-conformant server that omits it is falsely rejected (fail-closed,
  no funds move). **Fix:** because the fallback is stale-prone (C1), reconcile by
  making `contractAddress` **REQUIRED** in the spec to match the safe code.

- **M2 — `parsePrice` accepts unvalidated `amount`** (`server/scheme.ts:61,71,126`).
  Unlike the client (`/^[0-9]+$/`), the server publishes any `amount` — decimal
  (`"0.10"`), garbage, or **negative**. A negative amount makes the facilitator's
  rule-3 check (`available >= BigInt(amount)`, `scheme.ts:323`) true for *any* dust
  output → a non-SDK client gets the resource for ~free. Conditional on a
  server-side pricing bug (a client can't inject it). **Fix:** validate `amount`
  with `/^[0-9]+$/` at both `parsePrice` return points and reject negative/non-finite
  numbers in `parseMoneyToDecimal`.

- **M3 — sub-min-UTXO lovelace built, not rejected** (`signer.ts:442`).
  Spec (`:462`) requires build-time rejection; the client builds and signs a tx the
  chain can't accept, failing opaquely at the facilitator/node. **Fix:** fetch
  `coinsPerUtxoByte` and throw when `amount < minUtxoLovelace(size, cpub)` (don't
  enable `autoMinUtxo` — that silently overpays).

- **M4 — no `payTo` network-tag validation** (`constants.ts:143`, `client/scheme.ts:52`,
  `facilitator/scheme.ts:214`). `CARDANO_ADDRESS_REGEX` accepts either prefix for
  any network, and reference-built txs omit `networkId`, so a mainnet `payTo` on a
  preprod request passes `verify()` and fails only at submit — the rule-1 comment
  claiming address-tagging enforces this overclaims. **Fix:** check the bech32
  prefix / header against `getCardanoNetworkId(requirements.network)` in the client
  (before signing) and the facilitator (rule 3).

- **M5 — README instructs a security-bypassing override** (`README.md:68-76`).
  It tells integrators they "MUST override `runMethodSpecificChecks`" for script;
  doing so without `super` silently drops `verifyMasumiLock`, letting a bogus lock
  datum pass. **Fix:** rewrite to state the base class already enforces masumi +
  script checks and any override must call `super` first; document the
  `acceptMempool` gate in the `settle()` description.

- **M6 — e2e passes vacuously without a 402** (`e2e/test.ts:496`, clients
  `index.ts:244`). Payment assertions are gated behind `if (paymentResponse)`; a
  `requiresPayment` route that serves 200 with no challenge falls through to
  `success:true`. **Fix:** when `scenario.endpoint.requiresPayment`, fail the
  scenario if `payment_response` is absent.

- **M7 — stale e2e funding docs** (`e2e/README.md:191`, `express/index.ts:701`).
  `masumi-usdm` needs non-faucet preprod tUSDM + ~4 ADA; the README is
  self-contradictory. **Fix:** update the funding matrix.

---

## Low & Info (compact)

| # | Sev | Location | Issue → fix |
|---|-----|----------|-------------|
| L1 | Low | `facilitator/scheme.ts:484` | Dedupe claim released on a *post-broadcast* confirmation-timeout (contradicts "retain on mempool"). Distinguish pre- vs post-broadcast failure; retain once broadcast. |
| L2 | Low | `utils.ts:175` + `scheme.ts:231` | `signaturesValid` vacuously true for a witness-less script-spend; no payer-key-membership check → `verify()` can pass an unsettleable tx. Require `vkeyWitnessCount>0` + payer-key-hash membership for default/masumi. |
| L3 | Low | `verify.ts:118` | Script-participant rejection (fund-strand guard) untested. Add a negative test asserting `ERR_MASUMI_DATUM_INVALID`. |
| L4 | Low | `verify.ts:112` | Non-`FundsLocked` state rejection untested. Add a negative test. |
| L5 | Low | `core/utils/index.ts:100` | CIP-34 aliases (`cip34:0-1`) don't match through core routing (literal glob) despite mechanism support. Normalize before match, or document canonical-only. |
| L6 | Low | `signer.ts:382` | Nonce = `utxos[0]` → concurrent/rapid payments from one wallet contend on the same nonce. Pick a distinct/random UTXO or document single-flight. |
| L7 | Low | `package.json:46` | `@evolution-sdk/evolution: ^0.5.9` caret range while verification is byte-sensitive to it. Pin exact or narrow the range + CI-test the pin. |
| I1 | Info | spec `:100-103` | Step-8 prose says `txHash`/top-level `status`; schema + code use `transaction` + `extra.status`. Fix prose only. |
| I2 | Info | `scriptAddress.ts:79` | `Object.values(parameters)` reorders integer-like keys (fail-closed; hardening). Reject integer-like keys or use an array form. |
| I3 | Info | `server/scheme.ts:86` | `getAssetDecimals` returns 6 unconditionally (display/dollar-override only; EVM parity). Document subclass requirement for non-6-decimals tokens. |
| I4 | Info | `server/scheme.ts:102` | No 402-build-time structural validation of masumi/script extras (deferred failure is spec-consistent). Optionally validate early for better DX. |
| I5 | Info | `server/scheme.ts:111` | `enhancePaymentRequirements` blanket-spreads facilitator `supportedKind.extra` (no whitelist; unused today). Whitelist keys like SVM does. |
| I6 | Info | `stubs.ts:75`, integrations | The real `toClientCardanoSigner` build path has no unit/offline coverage (only a stub). Add an offline build test. |
| I7 | Info | integrations `:248`, e2e script route | Tests/e2e codify the datum-less script pattern (see C2). Replace with a spendable-datum pattern once C2 is fixed. |
| I8 | Info | spec `:240` | Script-section prose describes an insecure parameter-echo the code (correctly) doesn't follow. Align prose to the implementation. |
| I9 | Info | `e2e/facilitators/typescript/index.ts:267` | Mainnet mode reuses preprod-named Blockfrost env + single project id. Separate per-network config. |
| I10 | Info | `README.md:8,70,80`, changeset | Says "six verification rules"; spec/code have seven. Update to seven. |
| I11 | Info | `package.json:5,9` | `module` field points at non-existent `dist/esm/index.js`; dead `start` script. Fix/remove. |

---

## What is correct (verified — do not "fix")

- **Datum codec** (`datum.ts`): 19-field `Constr 0` order, Plutus `Address`/stake
  nesting, credential index, `Option<Address>`, fresh-lock invariants, round-trip,
  hex/case — all match `vested_pay.ak`, `plutus.json`, and Masumi's v2 decoder.
- **Facilitator core** (`facilitator/scheme.ts`): rules 1–7 (network, unsigned/
  invalid-signature rejection, TTL + lower-bound, nonce-in-inputs + on-chain +
  all-inputs-unspent, recipient/asset/amount, generic min-UTXO), method dispatch
  off `requirements.extra` (not client-echoed `accepted.extra`), atomic pre-await
  duplicate claim.
- **Tx decoding** (`utils.ts`): body-hash, per-witness Ed25519 verification,
  output/asset/datum parsing, `serializedSize`, `hasReferenceScript`/`datumOption`
  field names (suspected silent-no-ops are **not** present), network-id/TTL.
- **Masumi verify** (`verify.ts`): collateral floor `1_435_230`, lovelace-overpay
  vs exact-token semantics, exact-asset-set, reference-script rejection, ≥16-byte
  `reference_signature`, time ordering, TTL ≤ `pay_by_time`, post-result min-UTXO.
- **Server scheme** (`server/scheme.ts`): string-based Money→atomic conversion (no
  float error), asset-regex validation on passthrough + custom-parser results,
  correct extra-merge precedence (server wins).
- **Default-flow client** (`signer.ts`): `setValidity({to})` POSIX-ms→slot
  conversion is exact per network preset; single-address wallet keeps
  payer/change/nonce consistent; fee/change balancing correct.
- **Script hash derivation** (`scriptAddress.ts`): `applyParamsToScript` + hash +
  `payTo` binding + parameter encoding + CBOR unwrap.
- **API surface / build**: subpath exports disambiguate the three same-named
  `ExactCardanoScheme` classes; vitest globs pick up every test file; no export
  name collisions.

---

## Implementation plan (ordered)

**Phase 1 — stop fund loss (before any mainnet/preprod use)**
1. **C1** — correct `MASUMI_ESCROW_SCRIPT_HASH` → `a15ce9d8…5a3b14ad`; replace
   self-referential tests with an address-pinning/derivation test; guard `preview`.
2. **C2** — add the facilitator datum-presence check (reject datum-less script
   outputs for V1/V2, and V3 unless opted in); define `extra.datum`/`datumKind` in
   the spec; make the client refuse to build a datum-less script payment.
3. **H1** — size lovelace Masumi locks to `max(floor, amount + collateral)`; add
   the 2-ADA verify test.

**Phase 2 — close validation & CI gaps**
4. **H2** — run Cardano in CI (family branch + secrets + `.env`).
5. **M2** — validate `amount` in `parsePrice` (blocks the negative-amount bypass).
6. **M4** — validate `payTo` network tag (client + facilitator).
7. **M3** — reject sub-min-UTXO lovelace at build time.
8. **M1** — make `contractAddress` REQUIRED in the spec (match safe code).
9. **M5** — fix the README override guidance.

**Phase 3 — robustness, tests, docs**
10. **M6** — fail e2e scenarios lacking a PAYMENT-RESPONSE.
11. **L1/L2** — retain dedupe claim post-broadcast; add payer-signature check.
12. **L3/L4** — add the two Masumi negative regression tests.
13. **L5–L7, M7, I1–I11** — CIP-34 routing, nonce contention, SDK pin, funding
    docs, spec/README prose, and the info cleanups.

Phase 1 is the only work that blocks or moves real value and must ship first;
Phases 2–3 are correctness, interoperability, and hardening.
