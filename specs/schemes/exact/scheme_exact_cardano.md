# Scheme: exact on Cardano

## Summary

This document specifies the `exact` payment scheme for the x402 protocol on Cardano. The scheme facilitates payments of ADA and Cardano Native Tokens over the Cardano ledger, using signed transactions produced by the client and verified/settled by a resource server or facilitator.

This scheme is intentionally defined as an **implementation-agnostic, facilitator-neutral, vendor-neutral** core. It does not name, require, or privilege any specific third-party protocol, operator, or ecosystem implementation. Optional ecosystem-specific semantics (for example, escrow-based agent payment protocols, dispute windows, off-chain identifiers, or reputation systems) MUST be expressed through the x402 v2 **extensions** model, not through the core scheme.

The core scheme supports:

1. **Address-to-address payments** — the canonical Cardano x402 flow, sending ADA or a native asset to a payment address specified by the resource server.
2. **Script-parameterized payments** — a generic Cardano-native flow in which `payTo` is a script address and `extra` carries the information required for a client to reconstruct or validate that script address during transaction building.

Any additional flow that embeds the semantics of a specific external protocol (for example, Masumi) MUST be declared as an x402 extension; see [`specs/extensions/cardano_masumi.md`](../../extensions/cardano_masumi.md) for the Masumi extension.

## Protocol Flow

```mermaid
sequenceDiagram
    participant Client as Client/Agent
    participant Server as Server
    participant Facilitator as Facilitator
    participant Cardano as Cardano Blockchain

    %% Initial Request
    Client->>Server: 1. HTTP GET /api

    %% Payment Required Response
    Server->>Client: 2. HTTP 402 and Payment Details

    %% Client Prepares Payment
    Note over Client: 3. Client selects payment option,<br/>creates and <br/> signs a Transaction

    %% Request with Payment
    Client->>Server: 4. HTTP GET /api<br/>Header: PAYMENT-SIGNATURE (signed transaction)
    Note right of Client: Retries with payment header

    %% Server Verification
    alt Server Verification
        Server->>Server: 5. Verify transaction locally
    else Remote Verification (via Facilitator)
        Server->>Facilitator: 5. POST /verify<br/>(Payment Payload + Requirements)
        Note right of Facilitator: Facilitator validates:<br/>- Payment amount<br/>- Correct recipient<br/>- Nonce in Transaction
    end

    %% Server Verification
    alt Server Submission
        Server->>Cardano: 6a. Submit signed transaction
        Note right of Cardano: Node accepts tx into mempool;<br/>block inclusion is asynchronous
        Cardano-->>Server: 6b. Transaction hash (submission ack)
    else Remote Submission (via Facilitator)
      Server->>Facilitator: 6a. POST /settle<br/>(Payment details)
      Facilitator->>Cardano: 6b. Submit signed transaction
      Note right of Cardano: Node accepts tx into mempool;<br/>block inclusion is asynchronous
      Cardano-->>Facilitator: 6c. Transaction hash (submission ack)
      Facilitator->>Server: 6d. Settlement Response<br/>(txHash, status)
    end

    Note right of Server: 7. Receives transaction hash and status

    %% Final Response
    Server->>Client: 8. HTTP 200 OK + Resource<br/>Header: PAYMENT-RESPONSE
    Note left of Server: Returns requested resource<br/>with transaction confirmation:<br/>- transaction: "2f9a7b3c..."<br/>- network: "cardano:mainnet"<br/>- success: true
```

The protocol flow for `exact` on Cardano is client-driven.

1. **Client** makes an HTTP request to a **Resource Server**.

2. **Resource Server** responds with a `402 Payment Required` status, detailing the payment information:
   - For address-to-address payments, `payTo` is the address to which the payment MUST be sent; `extra` MAY be empty or carry facilitator-neutral hints.
   - For script-parameterized payments, `payTo` is the script address and `extra` carries the script reference (and any applied parameters) required for the client to build the transaction.

3. **Client** constructs the transaction body, signs it, and returns it to the **Resource Server** via the `PAYMENT-SIGNATURE` header.

4. **Resource Server** verifies the transaction is valid:
   - **Local verification**: The server validates the transaction structure, amount, and recipient directly.
   - **Remote verification**: The server forwards the `PAYMENT-SIGNATURE` header and `paymentRequirements` to a **Facilitator's** `/verify` endpoint.

5. After successful verification, the signed transaction is submitted to the Cardano blockchain:
   - **Server submission**: The **Resource Server** submits the transaction directly.
   - **Facilitator submission**: The **Resource Server** sends the transaction to the **Facilitator's** `/settle` endpoint, which submits it to the blockchain.

6. The Cardano node validates the submitted transaction and, if accepted, places it in its mempool and returns the transaction hash synchronously. Block inclusion — and any subsequent probabilistic confirmation — happens asynchronously and is observed later via the settlement `status` field.

7. **Resource Server** receives the transaction hash and status.
   - Cardano uses Ouroboros Praos, which has probabilistic finality. A transaction that has only been accepted into the mempool, or that appears in a recent block, can still be rolled back. Granting access on the basis of mempool acceptance alone (`status: "mempool"`) is therefore **strongly discouraged** and SHOULD NOT be used for any resource with real economic value. Servers that choose to accept mempool status MUST document this risk and accept full liability for rolled-back transactions.

8. **Resource Server** grants the **Client** access to the requested resource, returning an HTTP 200 OK response with a `PAYMENT-RESPONSE` header containing:
   - `transaction`: The Cardano transaction hash
   - `network`: The Cardano network (e.g., `cardano:mainnet`)
   - `status`: The transaction status (e.g., `confirmed` or `mempool`)

## Core Compliance Surface

An implementation claims conformance with the Cardano `exact` scheme by supporting the two core flows defined in this document (address-to-address and script-parameterized) and enforcing the verification rules in §Facilitator Verification Rules.

The core scheme:

- MUST NOT name, require, or privilege any specific third-party protocol, facilitator operator, product, or ecosystem implementation.
- MUST NOT embed ecosystem-specific fields (off-chain identifiers, agent-protocol fields, escrow timing windows, dispute windows, reputation identifiers, or similar) into the core `PaymentRequirements.extra` or the `payload` object.
- SHOULD treat any unknown fields in `extra` as pass-through information that does not affect core verification.
- SHOULD expose ecosystem-specific behavior through the x402 v2 extensions model (see §Extensions below).

## `PaymentRequirementsResponse`

### Core Schema (Address-to-Address)

When the Resource Server responds with a `402 Payment Required`, the body contains the payment requirements:

```js
{
  "x402Version": 2,
  "error": "PAYMENT-SIGNATURE header is required",
  "resource": {
    "url": "https://api.example.com/premium-data",
    "description": "Access to premium market data",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "cardano:mainnet", // cardano:preprod or cardano:preview for public testnets
      "amount": "10000", // atomic units of the asset
      "asset": "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad.0014df105553444d", // ${policyId}.${assetNameHex}; for ADA, use the reserved value "lovelace"
      "payTo": "addr1...",
      "maxTimeoutSeconds": 600,
      "extra": {
        // MAY be empty. MAY contain facilitator-neutral hints.
        // MUST NOT embed fields tied to a specific external protocol or operator.
      }
    }
  ]
}
```

**Notes:**

- The `asset` field follows the Cardano convention `${policyId}.${assetNameHex}`. For native ADA payments, implementations MUST use the reserved value `"lovelace"`.
- The `maxTimeoutSeconds` value SHOULD account for Cardano's slot/block cadence; values meaningfully below a single-block round trip SHOULD be avoided.

### Core Schema (Script-Parameterized Payment)

When the Resource Server requires payment to a script address, `payTo` is the script address and `extra` carries the information required to build and verify the payment against that script. Script-parameterized payments are a generic Cardano primitive and do not imply any specific off-chain protocol.

```js
{
  "x402Version": 2,
  "error": "PAYMENT-SIGNATURE header is required",
  "resource": {
    "url": "https://api.example.com/premium-data",
    "description": "Access to premium market data",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "cardano:mainnet",
      "amount": "10000",
      "asset": "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad.0014df105553444d",
      "payTo": "addr1...", // script address; MUST match the address derived from `extra.script` (plus any applied `extra.parameters`) after parameterization
      "maxTimeoutSeconds": 600,
      "extra": {
        "scriptHash": "script_hash_here", // OPTIONAL; if the script is already on-chain, its hash is sufficient for the client to resolve the full script
        "script": {
          // OPTIONAL; provided when the script is not yet on-chain or when the server wishes to attach the script body directly
          "type": "plutusV2" | "plutusV3" | "native",
          "code": "<hex-encoded script code>"
        },
        "parameters": {
          // OPTIONAL; script-specific parameters to be applied to a parameterised script during transaction building
          "param1": { "value": "Hello World", "type": "bytes" },
          "param2": { "value": 42, "type": "bigint" }
        }
      }
    }
  ]
}
```

**Normative rules:**

- Servers MUST include enough information in `extra` for a conforming client to derive the script address declared in `payTo`. A bare `scriptHash` is sufficient when the script is already on-chain; otherwise the full `script` body MUST be provided.
- If `parameters` are supplied, the client MUST apply them deterministically when constructing the transaction, and the derived address MUST equal `payTo`.
- A facilitator performing remote verification MUST validate that the transaction pays the declared `asset` and `amount` to `payTo`; it is NOT required to re-execute the script or interpret ecosystem-level semantics attached to it.

### Extensions (Ecosystem-Specific Semantics)

Any payment flow that depends on the semantics of a specific off-chain protocol (for example, escrow accounts, dispute windows, agent identifiers, seller verification keys, or inputs-hash commitments used by a particular agentic-payment framework) MUST be expressed as an x402 extension under the `extensions` field of the `PaymentRequired` and `PaymentPayload` objects.

Such extensions MUST NOT require changes to the fields specified in this document. Facilitators that do not implement a given extension MUST remain capable of verifying the core scheme, treating the extension as advisory.

For the Masumi escrow/agent-payment extension, see [`specs/extensions/cardano_masumi.md`](../../extensions/cardano_masumi.md).

## `PAYMENT-SIGNATURE` Header Payload

The `PAYMENT-SIGNATURE` header is base64-encoded and sent in the client's request to the resource server when paying for a resource.

The `payload` field of the `PAYMENT-SIGNATURE` header MUST contain:

| Field         | Type   | Required | Description                                                                       |
| ------------- | ------ | -------- | --------------------------------------------------------------------------------- |
| `transaction` | string | Yes      | The fully signed Cardano transaction, Base64-encoded (CBOR-serialised).           |
| `nonce`       | string | Yes      | A UTXO reference of the form `${txHash}#${index}` consumed as an input, used for replay prevention. |

Example `payload`:

```js
{
  "transaction": "AAAIAQDi1HwjSnS6M+WGvD73iEyUY2FRKNj0MlRp7+3SHZM3xCvMdB0AAAAAIFRgPKOstGBLCnbcyGoOXugUYAWwVzNrpMjPCzXK4KQWAQCMoE29VLGwftex8rhIlOuFLFNfxLIJlHqGXoXA8hx6l+LMdB0AAAAAIHbPucTRIEWgO6lzqukswPZ6i72IHEKK5LyM1l9HJNZNAQBthSeHDVK8Xr5/zp3JMZPLtG5uAoVgedTA4pEnp+h8qUlUzRwAAAAAIACH0swYW/QfGCFczGnjAVPHPqZrQE5vfvJr36i6KVEFAQAC7W4K5vCwB+nprjxcNlLiOQ7SIIfyCZjmj2qSis2iTsCuzBwAAAAAIAkSUkXOoeq52GNdhwpbs+jZqqrqPdmiN3oPw5EzDIanAQAIyFNGWD6OxiFIyXSxrNEcFG0npm+nImk6InUssXb1EZgx1hwAAAAAILhsjmMKyM0n75Cd7z6ufH2LNhOMibFOGhNlLgV5RFuEAQC+Mh4kGkLwrw/11729oUQnt3xOmOreE6PcnuN6M68ZBcCuzBwAAAAAIO2PQhSSqSAawCbRr005lfjBgFOqIHo4zb2GcQ/WCxAlAAgA+QKVAAAAAAAgjiAHD0X4HNSdVPpJtf2E6W2uRc8kbvCHYkgEQ1B+w1MDAwEAAAUBAQABAgABAwABBAABBQACAQAAAQEGAAEBAgEAAQcAHrfFfj8r0Pxsudz/0UPqlX5NmPgFw1hzP3be4GZ/4LEB5XXrONxGw0qOUsq3yNKeUhOCOgCIwaa4pswKaer66EKqPGwdAAAAACBrOIN4poutFUmHfB6FbFJu8GgXoPPTGQWREqFpPfvO1B63xX4/K9D8bLnc/9FD6pV+TZj4BcNYcz923uBmf+Cx7gIAAAAAAABg4xYAAAAAAAA=",
  "nonce": "662cbf645fcd8914eb89115b83970a950493dd2fbaf39dea3b96e8cbdc132939#0"
}
```

Full `PAYMENT-SIGNATURE` header (address-to-address):

```js
{
  "x402Version": 2,
  "resource": {
    "url": "https://api.example.com/premium-data",
    "description": "Access to premium market data",
    "mimeType": "application/json"
  },
  "accepted": {
    "scheme": "exact",
    "network": "cardano:mainnet",
    "amount": "10000",
    "asset": "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad.0014df105553444d",
    "payTo": "addr1...",
    "maxTimeoutSeconds": 600,
    "extra": {}
  },
  "payload": {
    "transaction": "AAAIAQDi1Hwj...AAAAAAA=",
    "nonce": "662cbf645fcd8914eb89115b83970a950493dd2fbaf39dea3b96e8cbdc132939#0"
  }
}
```

Full `PAYMENT-SIGNATURE` header (script-parameterized):

```js
{
  "x402Version": 2,
  "resource": {
    "url": "https://api.example.com/premium-data",
    "description": "Access to premium market data",
    "mimeType": "application/json"
  },
  "accepted": {
    "scheme": "exact",
    "network": "cardano:mainnet",
    "amount": "10000",
    "asset": "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad.0014df105553444d",
    "payTo": "addr1...", // script address
    "maxTimeoutSeconds": 600,
    "extra": {
      "scriptHash": "script_hash_here",
      "script": {
        "type": "plutusV3",
        "code": "<hex-encoded script code>"
      },
      "parameters": {
        "param1": { "value": "Hello World", "type": "bytes" },
        "param2": { "value": 42, "type": "bigint" }
      }
    }
  },
  "payload": {
    "transaction": "AAAIAQDi1Hwj...AAAAAAA=",
    "nonce": "662cbf645fcd8914eb89115b83970a950493dd2fbaf39dea3b96e8cbdc132939#0"
  }
}
```

## Facilitator Verification Rules

A facilitator MUST enforce all of the following rules before accepting a payment as valid. Any failure MUST result in a rejection. These rules are intentionally facilitator-neutral: they depend only on the signed Cardano transaction, the declared `PaymentRequirements`, and the current on-chain UTXO set.

1. **Network Validation**: The transaction MUST be destined for the Cardano network declared in `PaymentRequirements.network` (`cardano:mainnet`, `cardano:preprod`, or `cardano:preview`). Transactions built for a different network MUST be rejected.

2. **Recipient Verification**: At least one transaction output MUST pay funds to the address specified in `PaymentRequirements.payTo`. The facilitator MUST NOT accept transactions where no output targets `payTo`. When `payTo` is a script address declared via script-parameterized payment, the facilitator MAY verify that the declared script (with applied `parameters`) hashes to the same address, but MUST NOT be required to re-execute the script.

3. **Amount Verification**: The aggregate value sent to `payTo` for the declared `asset` MUST be greater than or equal to `PaymentRequirements.amount`.

4. **Asset Verification**: The asset unit in the transaction MUST exactly match `PaymentRequirements.asset`. For native tokens, both the policy ID and the asset name MUST match. For ADA, the reserved value `"lovelace"` MUST be used and the lovelace output MUST satisfy `amount`. The facilitator MUST NOT accept a different asset, even one of equal market value.

5. **Nonce / Replay Prevention**: `payload.nonce` MUST be a valid UTXO reference (`txHash#index`) that is consumed as an input of the transaction. The facilitator MUST verify that this UTXO exists in the current on-chain UTXO set and has not been spent. This ensures uniqueness and prevents replay.

6. **TTL / Expiry Check**: The transaction's TTL (time-to-live slot) MUST NOT have already passed at the time of verification. The facilitator MUST reject transactions whose TTL is in the past. The TTL SHOULD be consistent with `PaymentRequirements.maxTimeoutSeconds`.

Facilitators MAY enforce additional checks introduced by extensions when they implement those extensions, but extension-specific checks MUST NOT be treated as core conformance requirements.

## `PAYMENT-RESPONSE` Header Payload

The `PAYMENT-RESPONSE` header is base64-encoded and returned to the client by the resource server.

Schema:

```js
{
  "success": true, // true or false
  "network": "cardano:mainnet",
  "transaction": "2f9a7b3c...", // Cardano transaction hash if successful
  "extensions": {
    "status": "confirmed" // "confirmed" is the recommended value; "mempool" is permitted but strongly discouraged — see settlement warning above
  },
  "errorReason": "Utxo not found in utxo set" // OPTIONAL; present only on failure
}
```

## Extensions

Cardano-specific ecosystem semantics that go beyond the rules above MUST be carried through the x402 v2 extensions model, following the pattern:

```
extensions[extensionId].info   // extension-specific data
extensions[extensionId].schema // JSON Schema for `info`
```

Known Cardano-related extensions (non-exhaustive):

- [`cardano-masumi`](../../extensions/cardano_masumi.md) — Masumi escrow/agent-payment semantics, including seller verification keys, purchaser/agent identifiers, escrow timing windows, dispute windows, and input-hash commitments.

Additional Cardano-related extensions MAY be proposed to cover other ecosystem-level behaviors (e.g., alternative escrow protocols, metadata-label commitments, chain-of-custody attestations). They MUST follow the extensions architecture defined in the x402 v2 core specification and MUST NOT require changes to this document.

## Version History

| Version | Date       | Changes                                                                                         | Author    |
| ------- | ---------- | ----------------------------------------------------------------------------------------------- | --------- |
| 0.2     | 2026-04-23 | Remove vendor-specific `assetTransferMethod: "masumi"` and Masumi-named fields from the core scheme; move Masumi semantics to `specs/extensions/cardano_masumi.md`. Clarify that the core scheme is facilitator- and vendor-neutral. Add reserved `"lovelace"` value for native ADA `asset`. | QBT Labs  |
| 0.1     | 2026-02-06 | Initial Cardano `exact` scheme merged upstream.                                                  | Masumi    |
