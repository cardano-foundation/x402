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

These identifiers are deliberately human-readable and match the x402 Cardano spec; they are not canonical CAIP-2 (no registered `cardano` namespace exists). The CIP-34 forms `cip34:1-764824073` (mainnet), `cip34:0-1` (preprod), and `cip34:0-2` (preview) are accepted as input aliases and normalized to the canonical id above.

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

The facilitator only broadcasts the client's signed transaction, so its `mnemonic` is **optional** — omit it to run provider-only (no funds, no signer); when supplied it is used only to expose an address in the `/supported` response. The facilitator signer also implements the optional `evaluateTransaction` dry-run described below. A Koios provider (`{ koios: { baseUrl, token? } }`) may be used instead of Blockfrost.

## Testnet funds

Get test ADA (tADA) for `cardano:preprod` or `cardano:preview` from the official
[Cardano testnets faucet](https://docs.cardano.org/cardano-testnets/tools/faucet/). Only the
**client** needs funds: it builds and signs the complete transaction, so its wallet must hold the
asset it pays with plus a little ADA for the network fee. The **facilitator** only broadcasts that
signed transaction — it pays no fee and needs no funds. `asset: "lovelace"` is fundable directly
from the faucet; preprod **USDM** must be sourced separately, so use lovelace for quick live testing.

## Asset transfer methods

Per spec, three methods can be selected via `requirements.extra.assetTransferMethod`:

- `default` — address-to-address payments. No extra verification beyond the core rules.
- `masumi` — locks funds into Masumi's `vested_pay` escrow for **concrete agent-to-agent payments**. Issue the 402 with `issueMasumiRequirements` (it derives `payTo` from the deployment parameters, builds the request commitment and gets the seller's CIP-8 signature over `termsDigest`); the client and facilitator both re-verify that authorization, and the facilitator additionally checks the 19-field lock datum (`verifyMasumiLock`). No subclassing is required.
- `script` — locks funds into **any contract defined by the server**, with an optional arbitrary datum. The base facilitator reconstructs the script address from `extra.script`/`parameters` (or `scriptHash`) and verifies it equals `requirements.payTo`. Supply `extra.datum` (CBOR hex) to attach an inline datum for contracts that require one — the client attaches it verbatim; because the datum is arbitrary and contract-specific, the facilitator does **not** verify its contents, so a correct datum is the server's responsibility (a wrong or missing one strands the funds). Use this to lock into your own contract; use `masumi` for agent payments.

Overriding `runMethodSpecificChecks` is **not** required for any built-in method; if you subclass to add a custom method, call `super.runMethodSpecificChecks(...)` so the Masumi and script checks still run.

## Submission and confirmation policy

`requirements.extra.submissionPolicy` selects who broadcasts: `server` (the default when absent), `client`, or `either`. The paid payload echoes the normalized `submissionMode`, which must be allowed by the policy and must stay the same across retries for one transaction. Server mode requires a complete ledger phase-1 validator through `validatePhase1Transaction`; script evaluation alone is not enough. Client mode requires `getTransactionEvidence`, because the client broadcasts before the paid retry and the facilitator must authenticate that exact transaction. `/supported` advertises only modes for which these hooks exist.

`requirements.extra.confirmationPolicy.l1Confirmations` sets the evidence required before `settle()` reports success: `-1` authenticated mempool acceptance, `0` canonical block inclusion, `1..20` that many newer blocks. It defaults to `1`. Below the threshold, `settle()` returns `errorReason: "payment_pending"` with the strongest evidence in `extra`; the paid retry resumes observing the same transaction without resubmitting it.

Hydra settlement is **not implemented**: a `settlementLayer: "hydra"` payload is rejected and `/supported` advertises L1 only. Authenticating a Hydra payment needs verified Init state, head parameters, a seller-participant binding and `SnapshotConfirmed` evidence.

## Idempotency boundary

`settle()` is idempotent per canonical transaction ID, not one-shot. The spec requires a paid retry to repeat the exact original `PAYMENT-SIGNATURE` and the verifier to resume observing the same transaction, so a terminal "already settled" state would strand any payment that needs more confirmations than a single call can wait for. What this package guarantees is that a given transaction is **broadcast at most once** and always reports the same ledger truth.

A definitive pre-ledger rejection is terminal for that issued payment. The facilitator retains both the transaction and Masumi `termsDigest` tombstones, and the resource server marks the protected operation for manual reconciliation. It does not accept corrected transaction bytes after the handler has run: doing so could bind one handler result to a different payment. Ambiguous transport or node failures remain non-releasable for the same reason.

Binding a settled payment to a **single protected operation** is the resource server's responsibility, which the spec assigns explicitly: key the record by canonical transaction ID for `default` and `script`. For `masumi` the binding is stronger and already enforced here — `termsDigest` covers exactly one issued 402, so a payment cannot be reused against a second one (each carries a fresh `sellerNonce`).

Replay state must survive restarts. Resource servers must supply an atomic durable `CardanoOperationStore`; facilitators must supply an atomic durable `CardanoSettlementStore`. The process-local stores are available only through explicit configuration for tests and disposable development. They stop at their configured entry limit and must not be used in production.

Each Cardano 402 includes an opaque `cardanoReplayProtection` challenge bound to the request fingerprint and the selected requirements. The normal x402 v2 paid retry echoes this top-level extension. The first canonical transaction that uses the challenge consumes it; the same challenge can then retry only that transaction. Anonymous server-submission retries therefore remain bound to their original 402.

Client submission also requires a validated `requestBinding`. Its transaction is public before the paid request reaches the resource server, so an opaque HTTP challenge alone cannot stop a mempool observer from racing the request with another valid challenge. Run authentication before the x402 middleware and return the validated principal or tenant from `requestBinding`. Authorization, cookie and API-key headers remain part of the request fingerprint, but arbitrary non-empty header values do not prove authentication. Cached responses omit authentication and cookie headers. Production `CardanoOperationStore` implementations must persist challenge issuance and consumption atomically with operation claims.

## Masumi registry claims

A non-empty `terms.agentIdentifier` claims a Masumi V2 registry identity. The policy prefix alone proves nothing — anyone can copy a registered agent's identifier into their own terms — so such a claim is **rejected** unless you supply a `validateRegistryClaim` validator (on the facilitator config and, for the client, `validateMasumiRegistryClaim`) that independently checks the asset, seller authorization, metadata, endpoint, network and price on the selected network. Unregistered sellers (an absent, `null` or empty identifier) need no validator.

## Settlement status

Cardano uses Ouroboros Praos (probabilistic finality). `settle()` reports the strongest verified evidence in `extra` (`status`, `confirmations`, `submissionMode`). Granting access on `mempool` is **strongly discouraged** by the spec, so the facilitator refuses a mempool-only result unless the operator sets `acceptMempool` *and* the policy allows `-1`.

## Optional cryptographic authorization check

The facilitator's structural checks (network, recipient, amount, asset, nonce, TTL, witness presence) are inexpensive but do not prove the supplied witnesses actually authorize the consumed inputs. To close that gap, implement the optional `evaluateTransaction(signedTransactionBase64, network)` method on your `FacilitatorCardanoSigner`; the facilitator will call it after the structural checks pass and treat any thrown error as a verification failure. Typical implementations route this to a Cardano node `evaluate-tx` endpoint or to Blockfrost's `/utils/txs/evaluate`.

See `specs/schemes/exact/scheme_exact_cardano.md` for the full protocol description.
