# 183 — Example wallets come from the environment; no default addresses or mnemonics

**Context.** WP11's Check says the server starts "using only the annotation and application.yml". Receiving addresses, the Masumi seller mnemonic and the buyer mnemonic must come from somewhere. Defaults derived from a public BIP-39 test mnemonic would make the examples start with no setup, but anyone can spend from those addresses, and a copied example would pay sellers' money into them.

**Decision.**
- `application.yml` references `${PREPROD_PAY_TO}`, `${SELLER_MNEMONIC}` (and `${MAINNET_PAY_TO}` in the `mainnet` profile) without defaults. Only non-secret values have defaults (facilitator URLs on `127.0.0.1`).
- **How a missing value fails** (corrected after review; checked 2026-10-12 with the built jar). Spring Boot's `@ConfigurationProperties` binding keeps an unresolvable placeholder as literal text; it does not fail on it. The examples still fail closed, because the literal is not valid data:
  - `pay-to: ${PREPROD_PAY_TO}` → startup error from the Cardano address check (`CardanoAddressRules`): "pay-to ${PREPROD_PAY_TO} is not a Cardano address on cardano:preprod: invalid bech32 address";
  - `seller-mnemonic: ${SELLER_MNEMONIC}` (and the client's `${BUYER_MNEMONIC}`) → "Invalid mnemonic phrase" when the signer is built;
  - a literal `${BLOCKFROST_PREPROD_PROJECT_ID}` is **not** caught at startup; Blockfrost rejects it on the first chain call;
  - the facilitator's password no longer goes through property binding at all (decision 188).
- Clients read `BUYER_MNEMONIC` and `BLOCKFROST_PREPROD_PROJECT_ID` from the environment.
- Tests derive their addresses from the BIP-39 test mnemonic (`abandon … art`, account index 1) at run time; nothing is hard-coded.
- **Live check (2026-10-12).** The local `e2e/.env` has no seller mnemonic (decision 174). For the WP11 preprod walkthrough the Masumi seller was the public test mnemonic. It only signs Masumi quotes inside 402 responses; no Masumi option was paid, so no funds depended on it. Receiver, buyer and Blockfrost credentials were the e2e ones.

**Alternatives.** Public-mnemonic defaults (zero-setup start, unsafe to copy); `.env` files in the examples (secrets on disk next to the code).

**Consequences.** The walkthrough lists three `export` lines per process. The Check's "only the annotation and application.yml" holds for code and configuration; values still come from the environment, as in the TS, Go and Python examples.

**Reverse.** Add `:<default>` parts to the placeholders.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking. Flagged for user sign-off: the seller mnemonic used in the live check.
