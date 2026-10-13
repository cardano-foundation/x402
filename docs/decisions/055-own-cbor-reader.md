# 055 — Transactions are read with an in-module CBOR reader that keeps byte spans

**Context.** The transaction id is blake2b-256 of the body's exact wire bytes; min-UTxO uses each output's serialized size; the Masumi datum is checked as sent. cardano-client-lib's `Transaction.deserialize` re-serializes and truncates some integers (the lifted decoder works around this with several raw re-parses).

**Decision.** `org.x402.mechanisms.cardano.Cbor` decodes CBOR into items that remember their byte span. `CardanoTransactionDecoder` reads inputs, outputs (legacy and map forms, inline datums, reference scripts), fee, TTL, validity start, network id, the balance-changing fields and the witness set from it. `PlutusData` decodes and encodes Plutus data (Aiken convention). CCL is used for Ed25519, Blake2b, bech32 and HD keys only.

**Alternatives.** CCL deserialization plus raw re-parsing (what the lifted code does).

**Consequences.** WP8 can reuse `Cbor`, `PlutusData` and the decoder. About 400 lines owned here; covered by the fixture replay and unit tests.

**Reverse.** Swap the decoder implementation; `DecodedCardanoTransaction` is the stable view.
