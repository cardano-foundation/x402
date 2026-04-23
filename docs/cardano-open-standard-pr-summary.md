# PR Draft — Cardano `exact` scheme: open-standard boundary correction

**Branch:** `QBTLabs/cardano-open-standard-update`
**Target:** `x402-foundation/x402:main` (via Cardano Foundation review first)

## Summary

Revise the Cardano `exact` payment scheme so that its core compliance surface is facilitator-neutral, vendor-neutral, and implementation-agnostic. Move Masumi-specific semantics out of the core scheme and into a new `cardano-masumi` extension that follows the x402 v2 extensions architecture.

Masumi support is preserved in full. Only its placement in the specification changes.

## Motivation

The Cardano scheme as merged in commit `4840c8dfb82e27e92a0b584391ad10be473c59bb` includes:

- `assetTransferMethod: "default" | "masumi" | "script"` — an enum that names a specific third-party protocol as a peer of generic Cardano primitives.
- Masumi-specific fields inlined into `PaymentRequirements.extra` (`sellerVkey`, `paymentType: "Web3CardanoV1"`, `blockchainIdentifier`, `payByTime`, `submitResultTime`, `unlockTime`, `externalDisputeUnlockTime`, `agentIdentifier`, `inputHash`, `identifierFromPurchaser`).

This couples the core Cardano x402 scheme to a single ecosystem implementation. The consequences are:

- Every Cardano facilitator has to reason about Masumi-specific fields even when it does not support Masumi.
- Additional Cardano agent-payment or escrow protocols would need either their own enum value or second-class status.
- Future Masumi evolution forces a revision of a core scheme document.

The x402 v2 specification already defines the `extensions` object (`PaymentRequired.extensions`, `PaymentPayload.extensions`, `SettlementResponse.extensions`) as the canonical place for optional, composable functionality. Other ecosystems in the repo (Algorand, Sui, SVM, Stellar, Aptos, Hedera) keep their core schemes focused on ledger primitives and use extensions or scheme-specific `extra` fields that are generic to the network. Cardano should follow the same pattern.

## What changed

### Modified

- **`specs/schemes/exact/scheme_exact_cardano.md`** — rewritten so the core compliance surface describes only:
  - Address-to-address payments (ADA via reserved `"lovelace"` asset, or Cardano native tokens).
  - Script-parameterized payments (a generic Cardano primitive; Plutus scripts with applied parameters).
  - Facilitator verification rules (network, recipient, amount, asset, nonce/replay, TTL) that are independent of any off-chain protocol.
  - An explicit statement that ecosystem-specific semantics MUST be carried via the x402 v2 extensions model.
  - The `assetTransferMethod` enum has been removed. `"default"` and `"script"` are now described via field-shape rather than as vendor-adjacent enum values.

### Added

- **`specs/extensions/cardano_masumi.md`** — new extension that defines:
  - Where Masumi-specific fields live on the wire (`extensions["cardano-masumi"].info`).
  - The schema, semantics, and echo behaviour for `paymentType`, `blockchainIdentifier`, `sellerVkey`, `agentIdentifier`, `identifierFromPurchaser`, `inputHash`, and the four Masumi timing windows.
  - Responsibilities for clients, servers, and facilitators.
  - Core-compatibility rules so a non-Masumi facilitator can still verify the underlying script-parameterized payment.

- **`docs/cardano-open-standard-rationale.md`** — design note explaining the standards-architecture rationale.

- **`docs/cardano-open-standard-pr-summary.md`** — this document.

## What was moved from core into an extension

| Element                                                  | Was                                         | Now                                                                 |
| -------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------- |
| `assetTransferMethod: "masumi"`                          | core enum value in `PaymentRequirements.extra` | removed; replaced by the `cardano-masumi` extension                 |
| `sellerVkey`                                             | core `extra` field                          | `extensions["cardano-masumi"].info.sellerVkey`                      |
| `paymentType: "Web3CardanoV1"`                           | core `extra` field                          | `extensions["cardano-masumi"].info.paymentType`                     |
| `blockchainIdentifier`                                   | core `extra` field                          | `extensions["cardano-masumi"].info.blockchainIdentifier`            |
| `agentIdentifier`                                        | core `extra` field                          | `extensions["cardano-masumi"].info.agentIdentifier`                 |
| `identifierFromPurchaser`                                | core `extra` field                          | `extensions["cardano-masumi"].info.identifierFromPurchaser`         |
| `inputHash`                                              | core `extra` field                          | `extensions["cardano-masumi"].info.inputHash`                       |
| `payByTime` / `submitResultTime` / `unlockTime` / `externalDisputeUnlockTime` | core `extra` fields         | `extensions["cardano-masumi"].info.*`                               |

## What stayed in core

- Network identifiers `cardano:mainnet` / `cardano:preprod` / `cardano:preview`.
- `asset` convention `${policyId}.${assetNameHex}`, plus the reserved value `"lovelace"` for native ADA.
- `payTo` addresses (regular or script).
- `maxTimeoutSeconds`, TTL checks.
- `payload.transaction` (Base64-encoded signed CBOR) and `payload.nonce` (UTXO reference for replay prevention).
- Facilitator verification rules.
- Script-parameterized payments (`extra.scriptHash`, `extra.script`, `extra.parameters`) as a generic Cardano primitive.

## How this preserves openness while still supporting Masumi

- The core scheme makes no normative reference to Masumi.
- The extension makes Masumi fully expressible on the x402 wire, using the v2 extensions pattern that clients, servers, and facilitators already implement.
- A Masumi payment still flows through the core Cardano scheme as a script-parameterized payment, so a minimally conformant stack can verify the underlying transaction without understanding Masumi's off-chain semantics.
- Other ecosystem-level Cardano payment protocols (present or future) can publish their own extensions alongside `cardano-masumi` without any change to the core scheme.

## Backward compatibility

- Implementations that only supported the prior Masumi-in-core shape will need to either:
  1. Emit the same Masumi fields under `extensions["cardano-masumi"].info`, and keep `payTo`/`extra` pointed at the Masumi script, or
  2. Declare themselves as core-only Cardano `exact` implementations and drop the Masumi fields.
- The underlying on-chain transaction shape does not change.
- Facilitators that only implement the core scheme continue to verify payments correctly; they simply do not enforce Masumi-specific off-chain invariants (which they were never in a position to enforce anyway).

## Review path

1. Internal review by QBT Labs.
2. Cardano Foundation review (Fabian).
3. Upstream proposal to `x402-foundation/x402`.

## Non-goals

- This PR does not change Masumi's on-chain protocol or off-chain rules.
- This PR does not add or remove any chain, scheme, or facilitator implementation.
- This PR does not take a position on which Cardano agent-payment protocol implementations should be preferred.
