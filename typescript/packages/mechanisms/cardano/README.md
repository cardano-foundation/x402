# @x402/cardano

x402 Payment Protocol — Cardano `exact` scheme implementation.

This package implements the [`exact` scheme on Cardano](../../../../specs/schemes/exact/scheme_exact_cardano.md) for the x402 protocol. It provides:

- A **client scheme** (`@x402/cardano/exact/client`) that delegates transaction signing to a user-supplied `ClientCardanoSigner`.
- A **facilitator scheme** (`@x402/cardano/exact/facilitator`) that verifies and settles transactions per the spec's six verification rules.
- A **server scheme** (`@x402/cardano/exact/server`) that parses prices, defaults to USDM, and enhances payment requirements.

## Networks

The implementation registers the following x402 network identifiers, matching the spec verbatim:

| Network         | Identifier        | Cardano Network ID |
| --------------- | ----------------- | ------------------ |
| Mainnet         | `cardano:mainnet` | 1                  |
| Preprod testnet | `cardano:preprod` | 0                  |
| Preview testnet | `cardano:preview` | 0                  |

These identifiers are deliberately human-readable and match the x402 Cardano spec; they are not canonical CAIP-2.

## Asset format

Cardano native tokens are identified as `${policyId}.${assetNameHex}`, e.g. USDM Mainnet:

```
c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad.0014df105553444d
```

## Transaction decoding

CBOR transaction decoding in the facilitator uses Intersect's [Evolution SDK](https://www.npmjs.com/package/@evolution-sdk/evolution) — a pure-TypeScript Cardano serialization library with no WASM. It is bundled as a regular dependency; nothing extra to install.

## Reference signers

The client and facilitator schemes are signer-agnostic (e.g. a browser wallet can implement `ClientCardanoSigner` via CIP-30). For server-side keys, the package ships reference signers built on the Evolution SDK — `toClientCardanoSigner` builds, signs, and returns the payment transaction; `toFacilitatorCardanoSigner` performs chain lookups and submission.

```typescript
import { toClientCardanoSigner, toFacilitatorCardanoSigner } from "@x402/cardano";
import { ExactCardanoScheme as ExactCardanoClient } from "@x402/cardano/exact/client";
import { ExactCardanoScheme as ExactCardanoFacilitator } from "@x402/cardano/exact/facilitator";

const provider = { blockfrost: { baseUrl: process.env.BLOCKFROST_PREPROD_URL!, projectId: process.env.BLOCKFROST_PROJECT_ID! } };

// Client (payer)
const clientSigner = toClientCardanoSigner({ mnemonic, network: "cardano:preprod", provider });
client.register("cardano:*", new ExactCardanoClient(clientSigner));

// Facilitator (verify + settle). `awaitConfirmation` reports `confirmed` instead of `mempool`.
const facilitatorSigner = toFacilitatorCardanoSigner({ mnemonic, network: "cardano:preprod", provider, awaitConfirmation: true });
facilitator.register("cardano:preprod", new ExactCardanoFacilitator(facilitatorSigner));
```

The facilitator signer also implements the optional `evaluateTransaction` dry-run described below. A Koios provider (`{ koios: { baseUrl, token? } }`) may be used instead of Blockfrost.

## Asset transfer methods

Per spec, three methods can be selected via `requirements.extra.assetTransferMethod`:

- `default` — address-to-address payments. No extra verification beyond the six core rules.
- `masumi` — Masumi smart-protocol metadata in `extra`. The base verifier accepts the transfer; integrators may layer additional checks via subclassing.
- `script` — script-address payments. Integrators MUST override `runMethodSpecificChecks` to reconstruct the script address and verify it equals `requirements.payTo`.

## Settlement status

Cardano uses Ouroboros Praos (probabilistic finality). The default `settle()` returns whatever status the underlying signer reports. Granting access on `mempool` is **strongly discouraged** by the spec.

## Optional cryptographic authorization check

The facilitator's structural checks (network, recipient, amount, asset, nonce, TTL, witness presence) are inexpensive but do not prove the supplied witnesses actually authorize the consumed inputs. To close that gap, implement the optional `evaluateTransaction(signedTransactionBase64, network)` method on your `FacilitatorCardanoSigner`; the facilitator will call it after the structural checks pass and treat any thrown error as a verification failure. Typical implementations route this to a Cardano node `evaluate-tx` endpoint or to Blockfrost's `/utils/txs/evaluate`.

See `specs/schemes/exact/scheme_exact_cardano.md` for the full protocol description.
