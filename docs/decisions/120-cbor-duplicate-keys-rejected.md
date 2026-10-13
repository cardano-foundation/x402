# 120 — Duplicate CBOR map keys are a decode failure (security, fail closed)

**Context.** The independent WP7 review found that `Cbor.Item.get` returned the first entry for a repeated key, while Evolution (TS) builds maps with JS `Map.set`, so the last one wins (`CBOR.js:1793/1818/1848/1870`, `TransactionBody.js:310`). A body `{0: inputs, 1: [payTo output], 2: fee, 1: [attacker output]}` was valid in Java (it saw the first outputs) and `recipient_mismatch` in TS. The same split applied to map-form outputs (`{0: payTo, 1: value, 0: attacker}`) and the witness set. Red evidence: `ReviewHardeningTest` saw all three tampered, correctly signed transactions verify as **valid** before the fix.

**Decision.** Fail closed. The decoder requires unique keys in the transaction body, the witness set and every map-form output (`Cbor.Item.requireUniqueKeys`). `Cbor.Item.get(long)` and `get(String)` also throw on a repeated key, for any other keyed lookup. Integer and text keys compare by value, so a non-minimal encoding of the same number counts as a duplicate; other keys compare by wire bytes. The failure is `invalid_exact_cardano_payload_transaction_decode_failed`. Multi-asset maps keyed by bytes are not checked: Evolution unions them as Java does. COSE header re-encoding keeps Evolution's last-wins semantics on purpose, because it rebuilds the exact signed bytes TS verifies.

**Alternatives.**
- Last-wins like Evolution (parity, but it keeps an ambiguous encoding that the ledger itself rejects).
- Reject only the keys Java reads (leaves other duplicates silently ignored).

**Consequences.** A diverging verdict from TS only for transactions the Conway ledger would refuse anyway. No TS vector is exported for these cases, because TS's answer (last-wins) is not the Java answer. `ReviewHardeningTest` covers body key 1, output key 0 and witness-set key 0.

**Reverse.** Remove the `requireUniqueKeys` calls and the duplicate check in `get`.
