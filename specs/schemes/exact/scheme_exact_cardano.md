# Scheme: exact on Cardano

## Summary

This document specifies the `exact` payment scheme for the x402 protocol on Cardano. This scheme facilitates payments of Cardano Native Tokens.

It offers different assetTransferMethods to do x402 interactions:

1. Doing **Address-To-Address** Payments, similar to the regular x402 specifications on other chains.

2. Using the **Masumi Smart Protocol**, which offers additional refund mechanics & decision logging mechanisms in a decentralised way.

3. Performing payments to scripts using parameters that can be applied to scripts while transaction building.

## Network Identifiers

The canonical network identifiers for this scheme are `cardano:mainnet`, `cardano:preprod`, and `cardano:preview`. These are the only forms advertised in the `/supported` response.

These ids are valid CAIP-2 *syntax* over the `cardano` namespace, which is **not** a registered ChainAgnostic (CASA) namespace — so no strictly "canonical CAIP-2" form exists for Cardano. The scheme deliberately uses human-readable names because:

- The only standardized identifier is [CIP-34](https://cips.cardano.org/cip/CIP-0034)'s `cip34:NetworkId-NetworkMagic` form — `cip34:1-764824073` (mainnet), `cip34:0-1` (preprod), `cip34:0-2` (preview) — which disambiguates correctly but has poor developer/UX ergonomics.

Clients and facilitators **SHOULD** accept the CIP-34 forms above as **input aliases** and normalize them to the canonical id before matching, settlement, and chain selection. A facilitator MUST treat a CIP-34 alias and its canonical id as the same network (e.g. an `accepted.network` of `cip34:1-764824073` matches a `requirements.network` of `cardano:mainnet`). The alias set is closed and fixed; no other forms are recognized.

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
        Note right of Cardano: Transaction included in mempool or block
        Cardano-->>Server: 6b. Transaction hash + confirmation
    else Remote Submission (via Facilitator)
      Server->>Facilitator: 6a. POST /settle<br/>(Payment details)
      Facilitator->>Cardano: 6b. Submit signed transaction
      Note right of Cardano: Transaction included in mempool or block
      Cardano-->>Facilitator: 6c. Transaction hash + confirmation
      Facilitator->>Server: 6d. Settlement Response<br/>(txHash, status)
    end

    Note right of Server: 7. Receives transaction hash and status

    %% Final Response
    Server->>Client: 8. HTTP 200 OK + Resource<br/>Header: PAYMENT-RESPONSE
    Note left of Server: Returns requested resource<br/>with transaction confirmation:<br/>- transaction: "2f9a7b3c..."<br/>- network: "cardano:mainnet"<br/>- success: true
```

The protocol flow for `exact` on Cardano is client-driven. 

1.  **Client** makes an HTTP request to a **Resource Server**.

2.  **Resource Server** responds with a `402 Payment Required` status, detailing the payment information:
    - If using the Masumi Protocol, the `extra` field will contain additional information required to build a Masumi Smart Contract interaction.
    - If using Address-To-Address payments, the `payTo` field will contain the address to which the payment must be sent.
    - If using Script payments, the `extra` field will contain parameters to be applied to scripts during transaction building.

3.  **Client** constructs the transaction body, signs it, and returns it to the **Resource Server** via the `PAYMENT-SIGNATURE` header.

4.  **Resource Server** verifies the transaction is valid:
    - **Local verification**: The server validates the transaction structure, amount, and recipient address directly.
    - **Remote verification**: The server forwards the `PAYMENT-SIGNATURE` header and `paymentRequirements` to a **Facilitator's** `/verify` endpoint to check if the transaction is valid.

5.  After successful verification, the signed transaction is submitted to the Cardano blockchain:
    - **Server submission**: The **Resource Server** submits the transaction directly to the Cardano blockchain.
    - **Facilitator submission**: The **Resource Server** sends the transaction to the **Facilitator's** `/settle` endpoint, which then submits it to the blockchain.

6.  The Cardano blockchain includes the transaction in the mempool or a block and returns the transaction hash and confirmation status.

7.  **Resource Server** receives the transaction hash and status:
    - If submitted via the **Facilitator**, it receives a settlement response containing the `txHash` and `status`.
    - Cardano uses Ouroboros Praos, which has probabilistic finality. A transaction that appears in the mempool or even in a recent block can be rolled back. Granting access upon mempool inclusion (`status: "mempool"`) is therefore **strongly discouraged** and SHOULD NOT be used for any resource with real economic value. Servers that choose to accept mempool status MUST document this risk and accept full liability for rolled-back transactions.

8.  **Resource Server** grants the **Client** access to the requested resource, returning an HTTP 200 OK response with an `PAYMENT-RESPONSE` header containing:
    - `txHash`: The Cardano transaction hash
    - `network`: The Cardano network (e.g., `cardano:mainnet`)
    - `status`: The transaction status (e.g., `confirmed` or `mempool`)

### `PaymentRequirementsResponse`

#### Default Schema

When the Resource Server responds with a `402 Payment Required`, the body of the response contains the payment requirements in the following schema:

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
      "amount": "10000", // 1 USDM = 1000000000
      "asset": "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad.0014df105553444d", // ${policyId}.${assetName} The policy id in this example is the USDM policy id on Cardano Mainnet - use 16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde for USDM on Preprod. The asset name is the hex representation of '(333) USDM'
      "payTo": "addr1...",
      "maxTimeoutSeconds": 600, // Has to be set to a higher amount of time because of the Cardano Network speed
      "extra": {
        // In case of default address-to-address payments, this may be empty or contain additional metadata
      }
    }
  ]
}
```

#### Masumi assetTransferMethod Schema

When the Resource Server requires payment via the Masumi Smart Protocol, the `extra` field in the `PaymentRequirementsResponse` contains additional fields required for Masumi interactions.

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
      "amount": "10000", // 1 USDM = 1000000000
      "asset": "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad.0014df105553444d", // ${policyId}.${assetName} The policy id in this example is the USDM policy id on Cardano Mainnet - use 16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde for USDM on Preprod. The asset name is the hex representation of '(333) USDM'
      "payTo": "addr1...",
      "maxTimeoutSeconds": 600, // Has to be set to a higher amount of time because of the Cardano Network speed
      "extra": {
        "assetTransferMethod": "masumi", // optional, can be "default" | "masumi" | "script"
        // If the masumi assetTransferMethod is used, make sure to include all masumi related fields
        "identifierFromPurchaser": "aabbaabb11221122aabb",
        "sellerVkey": "sdasdqweqwewewewqe",
        "paymentType": "Web3CardanoV1",
        "blockchainIdentifier": "blockchain_identifier",
        "payByTime": "1713626260",
        "submitResultTime": "1713636260",
        "unlockTime": "1713636260",
        "externalDisputeUnlockTime": "1713636260",
        "agentIdentifier": "agent_identifier",
        "inputHash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
        // Additional fields for masumi or script assetTransferMethods can be added here
      }
    }
  ]
}
```

#### Script assetTransferMethod Schema

When the Resource Server requires payment to a script, the `extra` field in the `PaymentRequirementsResponse` contains additional fields required for script interactions.

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
      "amount": "10000", // 1 USDM = 1000000000
      "asset": "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad.0014df105553444d", // ${policyId}.${assetName} The policy id in this example is the USDM policy id on Cardano Mainnet - use 16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde for USDM on Preprod. The asset name is the hex representation of '(333) USDM'
      "payTo": "addr1...", // In case of script payments, this is the script address (the address should match the script provided in extra after applying parameters. In case of additional parameters provided, the client needs to pass the additional parameters to the server in the PAYMENT-SIGNATURE header, so that the server can reconstruct the script address and verify the payment)
      "maxTimeoutSeconds": 600, // Has to be set to a higher amount of time because of the Cardano Network speed
      "extra": {
        "assetTransferMethod": "script", // optional, can be "default" | "masumi" | "script"
        // If the script assetTransferMethod is used, make sure to include all script related fields
        "scriptHash": "script_hash_here", // If the script is already on-chain, provide its hash and the client can resolve the full script
        "script": {
          // Optional full script object if not on-chain yet
          "type": "plutusV3",
          "code": "<Hex-encoded script code here>",
        },
        "parameters": {
          "param1": {"value": "Hello World", "type": "bytes"},
          "param2": {"value": 42, "type": "bigint"}
          // Script-specific parameters required for transaction building
        }
        // Additional fields for script assetTransferMethods can be added here
      }
    }
  ]
}
```

### `PAYMENT-SIGNATURE` Header Payload

The PAYMENT-SIGNATURE header is base64-encoded and sent in the client's request to the resource server when paying for a resource.

The payload field of the PAYMENT-SIGNATURE header must contain the following fields:

transaction: The signed Cardano transaction (Base64 encoded).
Example:

```js
{
  "transaction": "AAAIAQDi1HwjSnS6M+WGvD73iEyUY2FRKNj0MlRp7+3SHZM3xCvMdB0AAAAAIFRgPKOstGBLCnbcyGoOXugUYAWwVzNrpMjPCzXK4KQWAQCMoE29VLGwftex8rhIlOuFLFNfxLIJlHqGXoXA8hx6l+LMdB0AAAAAIHbPucTRIEWgO6lzqukswPZ6i72IHEKK5LyM1l9HJNZNAQBthSeHDVK8Xr5/zp3JMZPLtG5uAoVgedTA4pEnp+h8qUlUzRwAAAAAIACH0swYW/QfGCFczGnjAVPHPqZrQE5vfvJr36i6KVEFAQAC7W4K5vCwB+nprjxcNlLiOQ7SIIfyCZjmj2qSis2iTsCuzBwAAAAAIAkSUkXOoeq52GNdhwpbs+jZqqrqPdmiN3oPw5EzDIanAQAIyFNGWD6OxiFIyXSxrNEcFG0npm+nImk6InUssXb1EZgx1hwAAAAAILhsjmMKyM0n75Cd7z6ufH2LNhOMibFOGhNlLgV5RFuEAQC+Mh4kGkLwrw/11729oUQnt3xOmOreE6PcnuN6M68ZBcCuzBwAAAAAIO2PQhSSqSAawCbRr005lfjBgFOqIHo4zb2GcQ/WCxAlAAgA+QKVAAAAAAAgjiAHD0X4HNSdVPpJtf2E6W2uRc8kbvCHYkgEQ1B+w1MDAwEAAAUBAQABAgABAwABBAABBQACAQAAAQEGAAEBAgEAAQcAHrfFfj8r0Pxsudz/0UPqlX5NmPgFw1hzP3be4GZ/4LEB5XXrONxGw0qOUsq3yNKeUhOCOgCIwaa4pswKaer66EKqPGwdAAAAACBrOIN4poutFUmHfB6FbFJu8GgXoPPTGQWREqFpPfvO1B63xX4/K9D8bLnc/9FD6pV+TZj4BcNYcz923uBmf+Cx7gIAAAAAAABg4xYAAAAAAAA="
}
```

Full PAYMENT-SIGNATURE header:

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
    "extra": {
      // In case of default address-to-address payments, this may be empty or contain additional metadata
    }
  },
  "payload": {
    "transaction": "AAAIAQDi1HwjSnS6M+WGvD73iEyUY2FRKNj0MlRp7+3SHZM3xCvMdB0AAAAAIFRgPKOstGBLCnbcyGoOXugUYAWwVzNrpMjPCzXK4KQWAQCMoE29VLGwftex8rhIlOuFLFNfxLIJlHqGXoXA8hx6l+LMdB0AAAAAIHbPucTRIEWgO6lzqukswPZ6i72IHEKK5LyM1l9HJNZNAQBthSeHDVK8Xr5/zp3JMZPLtG5uAoVgedTA4pEnp+h8qUlUzRwAAAAAIACH0swYW/QfGCFczGnjAVPHPqZrQE5vfvJr36i6KVEFAQAC7W4K5vCwB+nprjxcNlLiOQ7SIIfyCZjmj2qSis2iTsCuzBwAAAAAIAkSUkXOoeq52GNdhwpbs+jZqqrqPdmiN3oPw5EzDIanAQAIyFNGWD6OxiFIyXSxrNEcFG0npm+nImk6InUssXb1EZgx1hwAAAAAILhsjmMKyM0n75Cd7z6ufH2LNhOMibFOGhNlLgV5RFuEAQC+Mh4kGkLwrw/11729oUQnt3xOmOreE6PcnuN6M68ZBcCuzBwAAAAAIO2PQhSSqSAawCbRr005lfjBgFOqIHo4zb2GcQ/WCxAlAAgA+QKVAAAAAAAgjiAHD0X4HNSdVPpJtf2E6W2uRc8kbvCHYkgEQ1B+w1MDAwEAAAUBAQABAgABAwABBAABBQACAQAAAQEGAAEBAgEAAQcAHrfFfj8r0Pxsudz/0UPqlX5NmPgFw1hzP3be4GZ/4LEB5XXrONxGw0qOUsq3yNKeUhOCOgCIwaa4pswKaer66EKqPGwdAAAAACBrOIN4poutFUmHfB6FbFJu8GgXoPPTGQWREqFpPfvO1B63xX4/K9D8bLnc/9FD6pV+TZj4BcNYcz923uBmf+Cx7gIAAAAAAABg4xYAAAAAAAA="
    "nonce": "662cbf645fcd8914eb89115b83970a950493dd2fbaf39dea3b96e8cbdc132939#0"
  }
}
```

Expanded Schema based on assetTransferMethods:

#### Masumi assetTransferMethod

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
      "extra": {
        "assetTransferMethod": "masumi",
        "identifierFromPurchaser": "aabbaabb11221122aabb",
        "sellerVkey": "sdasdqweqwewewewqe",
        "paymentType": "Web3CardanoV1",
        "blockchainIdentifier": "blockchain_identifier",
        "payByTime": "1713626260",
        "submitResultTime": "1713636260",
        "unlockTime": "1713636260",
        "externalDisputeUnlockTime": "1713636260",
        "agentIdentifier": "agent_identifier",
        "inputHash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
      }
  },
  "payload": {
    "transaction": "AAAIAQDi1HwjSnS6M+WGvD73iEyUY2FRKNj0MlRp7+3SHZM3xCvMdB0AAAAAIFRgPKOstGBLCnbcyGoOXugUYAWwVzNrpMjPCzXK4KQWAQCMoE29VLGwftex8rhIlOuFLFNfxLIJlHqGXoXA8hx6l+LMdB0AAAAAIHbPucTRIEWgO6lzqukswPZ6i72IHEKK5LyM1l9HJNZNAQBthSeHDVK8Xr5/zp3JMZPLtG5uAoVgedTA4pEnp+h8qUlUzRwAAAAAIACH0swYW/QfGCFczGnjAVPHPqZrQE5vfvJr36i6KVEFAQAC7W4K5vCwB+nprjxcNlLiOQ7SIIfyCZjmj2qSis2iTsCuzBwAAAAAIAkSUkXOoeq52GNdhwpbs+jZqqrqPdmiN3oPw5EzDIanAQAIyFNGWD6OxiFIyXSxrNEcFG0npm+nImk6InUssXb1EZgx1hwAAAAAILhsjmMKyM0n75Cd7z6ufH2LNhOMibFOGhNlLgV5RFuEAQC+Mh4kGkLwrw/11729oUQnt3xOmOreE6PcnuN6M68ZBcCuzBwAAAAAIO2PQhSSqSAawCbRr005lfjBgFOqIHo4zb2GcQ/WCxAlAAgA+QKVAAAAAAAgjiAHD0X4HNSdVPpJtf2E6W2uRc8kbvCHYkgEQ1B+w1MDAwEAAAUBAQABAgABAwABBAABBQACAQAAAQEGAAEBAgEAAQcAHrfFfj8r0Pxsudz/0UPqlX5NmPgFw1hzP3be4GZ/4LEB5XXrONxGw0qOUsq3yNKeUhOCOgCIwaa4pswKaer66EKqPGwdAAAAACBrOIN4poutFUmHfB6FbFJu8GgXoPPTGQWREqFpPfvO1B63xX4/K9D8bLnc/9FD6pV+TZj4BcNYcz923uBmf+Cx7gIAAAAAAABg4xYAAAAAAAA="
    "nonce": "662cbf645fcd8914eb89115b83970a950493dd2fbaf39dea3b96e8cbdc132939#0"
  }
}
```

#### Script assetTransferMethod

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
        "assetTransferMethod": "script",
        "scriptHash": "script_hash_here",
        "script": {
          "type": "plutusV3",
          "code": "<Hex-encoded script code here>"
        },
        "parameters": {
          "param1": {"value": "Hello World", "type": "bytes"},
          "param2": {"value": 42, "type": "bigint"}
        }
      }
  },
  "payload": {
    "transaction": "AAAIAQDi1HwjSnS6M+WGvD73iEyUY2FRKNj0MlRp7+3SHZM3xCvMdB0AAAAAIFRgPKOstGBLCnbcyGoOXugUYAWwVzNrpMjPCzXK4KQWAQCMoE29VLGwftex8rhIlOuFLFNfxLIJlHqGXoXA8hx6l+LMdB0AAAAAIHbPucTRIEWgO6lzqukswPZ6i72IHEKK5LyM1l9HJNZNAQBthSeHDVK8Xr5/zp3JMZPLtG5uAoVgedTA4pEnp+h8qUlUzRwAAAAAIACH0swYW/QfGCFczGnjAVPHPqZrQE5vfvJr36i6KVEFAQAC7W4K5vCwB+nprjxcNlLiOQ7SIIfyCZjmj2qSis2iTsCuzBwAAAAAIAkSUkXOoeq52GNdhwpbs+jZqqrqPdmiN3oPw5EzDIanAQAIyFNGWD6OxiFIyXSxrNEcFG0npm+nImk6InUssXb1EZgx1hwAAAAAILhsjmMKyM0n75Cd7z6ufH2LNhOMibFOGhNlLgV5RFuEAQC+Mh4kGkLwrw/11729oUQnt3xOmOreE6PcnuN6M68ZBcCuzBwAAAAAIO2PQhSSqSAawCbRr005lfjBgFOqIHo4zb2GcQ/WCxAlAAgA+QKVAAAAAAAgjiAHD0X4HNSdVPpJtf2E6W2uRc8kbvCHYkgEQ1B+w1MDAwEAAAUBAQABAgABAwABBAABBQACAQAAAQEGAAEBAgEAAQcAHrfFfj8r0Pxsudz/0UPqlX5NmPgFw1hzP3be4GZ/4LEB5XXrONxGw0qOUsq3yNKeUhOCOgCIwaa4pswKaer66EKqPGwdAAAAACBrOIN4poutFUmHfB6FbFJu8GgXoPPTGQWREqFpPfvO1B63xX4/K9D8bLnc/9FD6pV+TZj4BcNYcz923uBmf+Cx7gIAAAAAAABg4xYAAAAAAAA="
    "nonce": "662cbf645fcd8914eb89115b83970a950493dd2fbaf39dea3b96e8cbdc132939#0"
  }
}
```

### Facilitator Verification Rules

A facilitator MUST enforce all of the following rules before accepting a payment as valid. Any failure MUST result in a rejection.

1. **Network Validation**: The transaction MUST be destined for the correct Cardano network (mainnet, preprod, or preview) as declared in `PaymentRequirements.network`. The facilitator MUST reject transactions built for a different network.

2. **Recipient Verification**: At least one transaction output MUST send funds to the address specified in `PaymentRequirements.payTo`. The facilitator MUST NOT accept transactions where the recipient address differs from `payTo`.

3. **Amount Verification**: The output sent to `payTo` MUST contain a value greater than or equal to the amount declared in `PaymentRequirements.amount` for the asset identified by `PaymentRequirements.asset`. The facilitator MUST verify both the policy ID and the asset name match exactly.

4. **Asset Verification**: The asset unit in the transaction MUST exactly match `PaymentRequirements.asset` (format: `${policyId}.${assetNameHex}`). The facilitator MUST NOT accept a different asset, even one of equal market value.

5. **Nonce / Replay Prevention**: The `payload.nonce` MUST be a valid UTXO reference (`txHash#index`) that is included as an input in the transaction. The facilitator MUST verify that this UTXO exists in the current on-chain UTXO set and has not been spent. This ensures uniqueness and prevents replay attacks.

6. **TTL / Expiry Check**: The transaction's TTL (time-to-live slot) MUST not have already passed at the time of verification. The facilitator MUST reject transactions whose TTL is in the past. The TTL SHOULD be consistent with `PaymentRequirements.maxTimeoutSeconds`.

### `PAYMENT-RESPONSE` Header Payload

The `PAYMENT-RESPONSE` header is base64-encoded and returned to the client by the resource server.

Once decoded, the `PAYMENT-RESPONSE` is a JSON string with the following properties:

Schema:

```js
{
  "success": true, // true or false
  "network": "cardano:mainnet",
  "transaction": "2f9a7b3c..." // Transaction hash of the payment if successful
  "extra": {
    "status": "confirmed", // "confirmed" is the recommended value; "mempool" is permitted but strongly discouraged — see settlement warning above
  }
  // Optional error field in case of failure
  "errorReason": "Utxo not found in utxo set" // Example error reason
}
```

## Transaction Fees

The **client** constructs and signs the complete transaction (Protocol Flow step 3). The Cardano network fee is a field of the transaction body, balanced against the client's own inputs — so the **client pays the fee**, alongside the asset being transferred.

The **facilitator** only broadcasts the already-signed transaction to the network. Broadcasting consumes none of the facilitator's funds, so a facilitator does **not** require a funded wallet — only a provider connection for UTXO/slot queries and transaction submission. A facilitator MAY expose an address (e.g. in the `/supported` response) for observability, but it is not used to pay or sign.

**Fee sponsorship** (the facilitator paying the fee on the client's behalf) is **not supported** by this scheme version. It is achievable on Cardano through collaborative, multi-party transaction building — the facilitator contributing an input to cover the fee and co-signing the transaction — but that requires a different, interactive construction flow than the client-builds-and-signs model specified here, and is left to a future extension.

## Minimum UTXO Value (min-ada)

Every Cardano transaction output must hold at least a minimum amount of ADA, proportional to the output's serialized size. The recipient output that carries the payment is subject to this rule, so the client must provide enough ADA for it. The ledger computes the per-output minimum (Babbage era onward, unchanged in Conway; see [CIP-55](https://cips.cardano.org/cip/CIP-0055)) as:

```
minUTxO(output) = (160 + |serialized_output|) * coinsPerUtxoByte
```

- `coinsPerUtxoByte` — a protocol parameter, currently **4310 lovelace/byte** on mainnet and the public testnets. It is governance-settable, so implementations MUST read it from live protocol parameters rather than hardcode it.
- `160` — a constant overhead (20 words x 8 bytes) covering the transaction input and its entry in the UTXO map.
- `|serialized_output|` — the CBOR byte length of the output (address, value, and any datum or script reference).

Because the threshold is a function of output size, **there is no single fixed value**:

- **Pure-lovelace payment** (`asset: "lovelace"`): the requested `amount` is itself the output coin and must satisfy the formula — in practice ~1 ADA (≈ 1,000,000 lovelace) for a minimal output. An `amount` below the minimum yields an unbalanceable transaction and MUST be rejected at build time.
- **Native-asset payment** (e.g. USDM): the multi-asset entry (28-byte policy id + asset name + quantity) enlarges the output, raising the minimum to roughly **1.2–1.5 ADA**. This ADA is sent **in addition to** the token amount, is drawn from the client's inputs, and travels with the token until the recipient spends the output.

The **client** funds this min-ada — it builds and signs the transaction (see [Transaction Fees](#transaction-fees)); the **facilitator** is uninvolved. Implementations SHOULD let the transaction builder derive the exact minimum from the protocol parameters fetched during construction, rather than assume a constant, so payments stay valid across protocol-parameter changes.

## Duplicate Settlement Mitigation (RECOMMENDED)

### Vulnerability

A race condition exists in the settlement flow: if the same signed transaction is submitted to the facilitator's `/settle` endpoint multiple times before the first submission is confirmed on-chain, each call may return a successful response.

Cardano's eUTXO model provides strong replay protection once a payment settles: the transaction consumes the `nonce` UTXO (Facilitator Verification Rule 5), so any later verification of a transaction that reuses that UTXO fails because the input no longer exists in the UTXO set. However, this guard only takes effect once the spend is observable on-chain. In the window between submission and confirmation, two concurrent `/settle` calls can each verify the nonce as still unspent and submit the same transaction. Cardano nodes deduplicate transactions by hash — a transaction already in the mempool or a recent block is not re-applied — so the second submission does not double-spend, but the facilitator may still return `success` to every caller. A malicious client can exploit this to obtain access to multiple resources while only paying once.

### Recommended Mitigation

Merchants and/or Facilitators SHOULD maintain a short-term, in-memory cache of transaction payloads that are currently being settled. Before proceeding with settlement, the merchant/facilitator checks whether the transaction has already been seen:

1. After verification succeeds, derive a cache key from the transaction payload (e.g., the base64-encoded signed transaction string).
2. If the key is already present in the cache, reject the settlement with a `"duplicate_settlement"` error.
3. If the key is not present, insert it into the cache — atomically, before the first `await` on submission, so concurrent calls cannot both pass the check — and proceed with submission.
4. Evict entries older than ~120 seconds. The on-chain nonce spend is the durable replay guard, so the cache only needs to cover the unconfirmed window; a transaction whose TTL has already passed can no longer land regardless.

The claim SHOULD be released if submission fails with a transient error, so a legitimate retry can re-attempt; it SHOULD be retained on success (including `mempool`-only inclusion) so retries cannot rebroadcast the same transaction.

This approach requires no external storage or long-lived state — only an in-process map with time-based eviction. It preserves the facilitator's otherwise stateless design while closing the duplicate settlement attack vector. Note that the cache is per-process: across multiple facilitator instances it does not deduplicate, but the on-chain nonce spend (Rule 5) remains the authoritative cross-instance replay guard.

