# 041 — Min-UTxO and Masumi datum sizes are measured on the wire bytes

**Context.** TS computes an output's `serializedSize` by re-encoding the decoded output with Evolution (`TxOut.toCBORBytes`), and the Masumi datum size from `Data.toCBORHex` of the decoded datum. The ledger measures the bytes that were actually submitted.

**Decision.** Java's decoder reports the byte length of each output's wire encoding and the inline datum's wire bytes. Nothing is re-encoded (decision 055).

**Alternatives.** Re-implement Evolution's encoder to reproduce its re-encoding exactly (large, and diverges from the ledger for non-Evolution encodings).

**Consequences.** Identical results for transactions encoded by Evolution or Aiken-style builders (all exported fixtures). For a transaction another builder encoded non-canonically, Java judges min-UTxO the way the ledger does, where TS may judge a re-encoded size.

**Reverse.** Replace `Cbor.Item.size()` and the raw datum hex with a canonical re-encoding in `CardanoTransactionDecoder`.
