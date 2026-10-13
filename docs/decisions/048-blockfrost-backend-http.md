# 048 — Blockfrost backend over java.net.http with the TS reference semantics

**Context.** The plan requires a Blockfrost implementation of `CardanoChainBackend` including the transaction-evidence read. cardano-client-lib's Blockfrost backend lacks the evidence and consumed reads and adds its own model layers.

**Decision.** `BlockfrostChainBackend` calls the REST API directly (Jackson from core for JSON), mirroring TS `toFacilitatorCardanoSigner` and `blockfrostQueries`:
- `getUtxo`: `/txs/{hash}/utxos` with `consumed_by_tx`; when the field is absent, the owner's `/addresses/{addr}/utxos` (at most 50 pages).
- current slot from the injected Clock and the network's slot config.
- `/epochs/latest/parameters`, cached 10 minutes.
- `POST /tx/submit` (`application/cbor`, the exact bytes), with `awaitConfirmation` defaulting to `true` like TS (wait up to the request timeout, then report mempool).
- evidence from `/txs/{hash}` and `/blocks/latest` (phase-2-invalid → unknown).
- evaluation via `/utils/txs/evaluate/utxos`, like Evolution.
- request timeout default 10 s, allowed 1 ms to 120 s.

**Alternatives.** CCL `BFBackendService` plus extra raw calls (two HTTP stacks).

**Consequences.** One small class, covered with WireMock (`BlockfrostChainBackendTest`). Koios is not offered (plan non-goal).

**Reverse.** Implement `CardanoChainBackend` on another provider; the SPI is unchanged.
