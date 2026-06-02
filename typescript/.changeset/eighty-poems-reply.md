---
"@x402/cardano": minor
---

Add Cardano `exact` scheme implementation.

- Introduces new `@x402/cardano` package with client, server, and facilitator scheme implementations for the x402 v2 `exact` scheme on Cardano.
- Supports the three `assetTransferMethod` variants from the spec: address-to-address (`default`), Masumi smart protocol (`masumi`), and script payments (`script`).
- Registers `cardano:mainnet`, `cardano:preprod`, and `cardano:preview` network identifiers.
- Ships with USDM as the default money parser; lovelace and arbitrary native tokens (`policyId.assetNameHex`) supported as first-class assets.
- Facilitator enforces the spec's six verification rules (network, recipient, amount, asset, nonce/replay, TTL) plus a transaction-signed check; optional `evaluateTransaction` hook for cryptographic authorization checks.
