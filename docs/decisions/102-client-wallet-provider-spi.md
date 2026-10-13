# 102 — Client chain reads are a small `CardanoWalletProvider` SPI implemented by the Blockfrost backend

**Context.** The client needs the wallet's UTxOs and the protocol parameters, but no submission, evidence or single-UTxO lookups. The plan (§1a/§2) configures the client as a `networks[]` list with one signer per network and one Blockfrost project id per network. WP8's allowed-file list names only `exact/client` and `signer`; the coordinator's WP8 brief allows all of `java/x402-mechanism-cardano/**`.

**Decision.** Add `chain.CardanoWalletProvider` (`getAddressUtxos(address, network)` and `getProtocolParameters(network)`) and the record `chain.WalletUtxo` (txHash, index, address, coin, assets, hasReferenceScript). `BlockfrostChainBackend` implements the SPI: it reads `/addresses/{addr}/utxos` paged by 100, and a 404 means an empty wallet. One `MnemonicClientCardanoSigner` serves one network, through `ClientCardanoSignerConfig.walletProvider`; the Spring client (WP9+) builds one per `networks[]` entry. The client is never given a submit path (B2). The test double is `testing/StubWallet`. Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking; flagged for user sign-off in the final report.

**Alternatives.**
- Make the signer take the whole `CardanoChainBackend` (gives the client a submit method it must never call).
- A client-only Blockfrost class (duplicates the HTTP and rate-limit code).

**Consequences.** `chain/` and `testing/` changed beyond the WP's file list, within the coordinator's grant. The WP8 Allowed files section is updated to match.

**Reverse.** Move the two methods into a client-local interface.
