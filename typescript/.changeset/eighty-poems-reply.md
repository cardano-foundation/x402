---
"@x402/cardano": minor
---

Add Cardano `exact` scheme implementation.

- Introduces new `@x402/cardano` package with client, server, and facilitator scheme implementations for the x402 v2 `exact` scheme on Cardano.
- Supports the three `assetTransferMethod` variants from the spec: address-to-address (`default`), Masumi smart protocol (`masumi`), and script payments (`script`).
- Registers `cardano:mainnet`, `cardano:preprod`, and `cardano:preview` network identifiers.
- Declares the `authorization` payment flow for every `assetTransferMethod`.
- Ships `DEFAULT_ASSETS` / `getDefaultAsset` / `findDefaultAsset` with USDM on mainnet and preprod, so `"$0.10"` and `"0.10 USDM"` prices resolve and client spend controls recognise USDM; lovelace and arbitrary native tokens (`policyId.assetNameHex`) are supported as first-class `AssetAmount`s.
- Facilitator enforces the spec's six verification rules (network, recipient, amount, asset, nonce/replay, TTL) plus a transaction-signed check; optional `evaluateTransaction` hook for cryptographic authorization checks.
- Masumi quotes are persisted by the scheme itself: `MasumiTermsStorage` (with an `InMemoryMasumiTermsStorage` default) keys each issued 402 by `termsDigest`, holds the paid retry to that exact quote, and binds the first transaction to claim it. `default` and `script` payments need no storage.
