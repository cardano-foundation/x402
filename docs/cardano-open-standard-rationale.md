# Cardano on x402: Open-Standard Boundary Rationale

## TL;DR

The core `exact` scheme on Cardano should define **only the minimum interoperable payment semantics** needed to make a Cardano x402 payment verifiable by any facilitator, on any Cardano network, by any implementation. Any semantics that are tied to a specific off-chain protocol, product, operator, or ecosystem implementation — including the Masumi escrow / agent-payment protocol — belong in an **x402 extension**, not in the core scheme.

This is not a rejection of Masumi. Masumi can remain fully supported on Cardano x402 through the `cardano-masumi` extension defined in [`specs/extensions/cardano_masumi.md`](../specs/extensions/cardano_masumi.md). The goal of this note is to explain why drawing the standards boundary in this place yields a better open standard.

## What changed

1. The core Cardano `exact` scheme no longer declares an `assetTransferMethod` enum whose values name a specific third-party protocol. The previous enum `"default" | "masumi" | "script"` has been collapsed into two neutral, generic Cardano flows:
   - address-to-address payments
   - script-parameterized payments (a generic Cardano primitive; Plutus scripts with applied parameters)
2. The Masumi-specific fields (`sellerVkey`, `paymentType: "Web3CardanoV1"`, `blockchainIdentifier`, `payByTime`, `submitResultTime`, `unlockTime`, `externalDisputeUnlockTime`, `agentIdentifier`, `inputHash`, `identifierFromPurchaser`) are removed from the core scheme and relocated to the `cardano-masumi` extension.
3. The core scheme adds explicit language stating that it is facilitator-neutral, vendor-neutral, and implementation-agnostic, and that ecosystem-specific behaviour MUST be expressed through extensions.

Full Masumi functionality is preserved. Only its **placement** in the specification changes.

## Why core schemes should describe MUST-support behaviour only

An x402 scheme document defines the minimum surface every conformant implementation must understand to interoperate. When vendor-specific semantics leak into that surface, three concrete harms follow:

- **Every implementation pays the cost.** A facilitator that never intends to handle Masumi still has to parse, schema-validate, and ignore Masumi-specific fields, because they live in the core `extra` object. This inflates the conformance surface.
- **Naming a vendor in an enum privileges it.** `assetTransferMethod: "masumi"` is qualitatively different from `"default"` or `"script"`: it treats one ecosystem project as a peer of generic Cardano primitives. Future ecosystem projects would either have to negotiate their own enum value (turning the standard into a registry of vendors) or accept second-class status.
- **Standards boundaries calcify.** Once a vendor field is in the core, removing it later is a breaking change. Moving it to an extension while the scheme is young and adoption is still small is much cheaper than doing so later.

The x402 v2 core specification already provides the correct mechanism for optional, composable functionality: the `extensions` object in `PaymentRequired`, `PaymentPayload`, and `SettlementResponse`. That mechanism is exactly where ecosystem-specific semantics should live.

## Why script-parameterized payments belong in core

Plutus scripts with applied parameters are a **generic Cardano primitive**, not a vendor feature. Any Cardano-native payment flow — Masumi's escrow, an alternative agent-payment protocol, a milestone-release protocol, a subscription escrow, a vault — ultimately expresses itself as a payment to a script address with some datum and redeemer. The core scheme therefore needs to describe "pay to a script address, with the client able to reconstruct that address from the declared script and parameters." It does not need to describe the off-chain semantics attached to any particular script.

Keeping script-parameterized payments in core while pushing off-chain semantics into extensions is the standards-architecturally correct split: core describes what the ledger verifies, extensions describe what off-chain protocols verify.

## Why this improves interoperability

- **Multi-facilitator support.** A facilitator can claim conformance with the Cardano `exact` scheme without committing to any specific agent-payment protocol. New facilitators can enter the ecosystem without first implementing Masumi.
- **Multi-ecosystem support.** Other Cardano agent-payment or escrow protocols (present or future) can declare extensions alongside `cardano-masumi` without a spec change. The core scheme doesn't need to list them.
- **Cleaner client contracts.** A client library targeting the Cardano `exact` scheme has a small, stable contract: address-to-address and script-parameterized payments. Ecosystem-specific stacks are opt-in via extension libraries.
- **Clearer verification.** Facilitator verification rules depend only on the transaction and the declared `PaymentRequirements`. They do not depend on interpreting off-chain identifiers tied to a specific ecosystem.
- **Predictable forward evolution.** When Masumi itself evolves — a `Web3CardanoV2`, new windows, new identifiers — the core Cardano scheme does not need to version. The extension versions independently.

## Why this is a standards-boundary correction, not anti-Masumi

Masumi is one of the earliest and most substantial Cardano agent-payment deployments, and its on-chain and off-chain design are sophisticated. Shipping Cardano x402 support with Masumi as a reference integration is a good thing. The problem is strictly one of layering:

- Masumi-specific fields currently sit where every Cardano x402 implementation has to reason about them.
- The x402 v2 extensions model exists precisely for these kinds of fields.
- Moving the fields one layer up costs Masumi nothing in functionality and gains the standard everything in neutrality.

Said differently: the revised placement improves Masumi's position in the ecosystem, because it gives Masumi a clean, named, versioned extension it can evolve on its own cadence, instead of being coupled to the cadence of the Cardano core scheme.

## Design principles applied

The revised Cardano `exact` scheme follows three principles that the broader x402 spec already applies to other chains:

1. **If it's a ledger primitive, it can live in core.** Address transfers, native-asset references, Plutus script parameterization, TTL, UTXO-based replay prevention.
2. **If it's an off-chain protocol or product-specific behaviour, it belongs in an extension.** Escrow timing windows, dispute windows, vendor-specific identifiers, agent/seller identities, vendor-specific datum shapes.
3. **The core scheme MUST NOT name a specific vendor, operator, or ecosystem implementation as a first-class value or field.** Extensions are the correct place for those names.

These principles are neither novel nor controversial. They are applied consistently across the `eip155`, `svm`, `sui`, `aptos`, `algorand`, `stellar`, and `hedera` schemes already in the repository. Applying them to Cardano brings Cardano in line with the rest of the standard.

## Open questions (non-blocking)

- **Optional receipt-style acknowledgement.** Masumi has a natural notion of commitment to off-chain inputs (`inputHash`) and delivery windows. The `offer-receipt` extension in the x402 repo may be a good fit for some of these; future work can explore whether a Cardano-flavoured offer/receipt is useful.
- **Alternative Cardano agent-payment protocols.** If other teams propose agent-payment extensions on Cardano, the shape of `cardano-masumi` can serve as a template for common field placement (timing windows, agent identifiers, commitments).
- **ADA vs. native-asset normalisation.** The revised core scheme reserves the string `"lovelace"` for native ADA payments, which is a straightforward convention; implementers should confirm this aligns with existing Cardano SDK idioms in the repository.
