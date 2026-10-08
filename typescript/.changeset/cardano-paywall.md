---
"@x402/paywall": minor
"@x402/cardano": minor
---

Added a Cardano paywall (`@x402/paywall/cardano`) so browser visitors can pay `cardano:*` exact-scheme routes (default transfer method, ADA or native tokens) with any CIP-30 wallet. The server fetches network parameters from Koios and injects them into the page; the browser makes no chain-provider calls, and the wallet only signs. `@x402/cardano` gains `createCip30ClientCardanoSigner`, a default-method client signer for CIP-30 wallets that bounds the supplied protocol parameters and refuses any transaction that is not exactly the requested payment plus change.
