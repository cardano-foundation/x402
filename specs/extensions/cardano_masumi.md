# Extension: `cardano-masumi`

## Status

**Draft — v0.1**. This extension is specified as an optional, composable addition to the Cardano `exact` scheme. Its behavioral requirements are stable; its wire shape MAY evolve to align with future updates to the x402 extensions architecture.

## Summary

The `cardano-masumi` extension adds escrow-based, agent-oriented payment semantics on top of the core Cardano `exact` scheme defined in [`specs/schemes/exact/scheme_exact_cardano.md`](../schemes/exact/scheme_exact_cardano.md). It is the canonical way to carry Masumi-specific fields — seller verification keys, purchaser/agent identifiers, input-hash commitments, and the escrow timing windows (`payByTime`, `submitResultTime`, `unlockTime`, `externalDisputeUnlockTime`) — across an x402 flow without embedding them in the core scheme.

Resource servers that integrate with Masumi MUST declare their Masumi intent via this extension. Resource servers, clients, and facilitators that do not implement this extension MUST remain able to process the underlying Cardano `exact` payment as a generic script-parameterized payment (see §Core Compatibility below).

This placement preserves three properties:

1. The core Cardano scheme remains implementation-agnostic and vendor-neutral.
2. Masumi support continues to be fully expressible and unambiguous.
3. Multiple agent-payment protocols can coexist on Cardano without each needing a privileged slot in the core scheme.

## Relationship to the Core Cardano Scheme

The core Cardano `exact` scheme supports payments to script addresses via script-parameterized payments. A Masumi payment is, on-chain, a script-parameterized payment to the Masumi smart contract address, with a specific datum and redeemer shape.

All core verification rules (network, recipient, amount, asset, nonce/replay, TTL) from the Cardano scheme continue to apply. This extension layers the off-chain Masumi semantics on top of those rules.

## `PaymentRequired`

A resource server advertises Masumi support by including the `cardano-masumi` extension in the `extensions` object of the **402 Payment Required** response, alongside a Cardano `exact` `accepts[]` entry that points at the Masumi script address.

```json
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
      "payTo": "addr1...", // Masumi script address for this payment
      "maxTimeoutSeconds": 600,
      "extra": {
        "scriptHash": "masumi_script_hash",
        "script": {
          "type": "plutusV3",
          "code": "<hex-encoded script code, if not on-chain>"
        },
        "parameters": {
          // generic script parameters, as defined by the core Cardano scheme
        }
      }
    }
  ],
  "extensions": {
    "cardano-masumi": {
      "info": {
        "paymentType": "Web3CardanoV1",
        "blockchainIdentifier": "blockchain_identifier",
        "sellerVkey": "sdasdqweqwewewewqe",
        "agentIdentifier": "agent_identifier",
        "identifierFromPurchaser": "aabbaabb11221122aabb",
        "inputHash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        "payByTime": "1713626260",
        "submitResultTime": "1713636260",
        "unlockTime": "1713636260",
        "externalDisputeUnlockTime": "1713636260"
      },
      "schema": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "paymentType": { "type": "string" },
          "blockchainIdentifier": { "type": "string" },
          "sellerVkey": { "type": "string" },
          "agentIdentifier": { "type": "string" },
          "identifierFromPurchaser": { "type": "string" },
          "inputHash": { "type": "string" },
          "payByTime": { "type": "string" },
          "submitResultTime": { "type": "string" },
          "unlockTime": { "type": "string" },
          "externalDisputeUnlockTime": { "type": "string" }
        },
        "required": [
          "paymentType",
          "blockchainIdentifier",
          "sellerVkey",
          "agentIdentifier",
          "identifierFromPurchaser",
          "inputHash",
          "payByTime",
          "submitResultTime",
          "unlockTime",
          "externalDisputeUnlockTime"
        ]
      }
    }
  }
}
```

## `PaymentPayload`

A client that recognises the `cardano-masumi` extension echoes it in the `extensions` field of the `PaymentPayload`, per the v2 rule that the client MUST include at least the info it received:

```json
{
  "extensions": {
    "cardano-masumi": {
      "info": {
        "paymentType": "Web3CardanoV1",
        "blockchainIdentifier": "blockchain_identifier",
        "sellerVkey": "sdasdqweqwewewewqe",
        "agentIdentifier": "agent_identifier",
        "identifierFromPurchaser": "aabbaabb11221122aabb",
        "inputHash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        "payByTime": "1713626260",
        "submitResultTime": "1713636260",
        "unlockTime": "1713636260",
        "externalDisputeUnlockTime": "1713636260"
      },
      "schema": { /* same schema as above */ }
    }
  }
}
```

A client MAY add extension-defined fields that the server did not include (per the v2 rule that the client may append additional info but cannot delete or overwrite existing info). A client MUST NOT silently drop any field received from the server.

## Field Semantics

All fields are Masumi-specific and have no meaning in the core Cardano `exact` scheme.

| Field                        | Type   | Required | Description                                                                                                                  |
| ---------------------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `paymentType`                | string | Yes      | Masumi payment-protocol tag (e.g., `"Web3CardanoV1"`). Identifies the Masumi variant in use.                                 |
| `blockchainIdentifier`       | string | Yes      | Masumi blockchain identifier for the logical payment stream.                                                                 |
| `sellerVkey`                 | string | Yes      | Verification key of the seller in the Masumi protocol.                                                                       |
| `agentIdentifier`            | string | Yes      | Masumi agent identifier for the service.                                                                                     |
| `identifierFromPurchaser`    | string | Yes      | Identifier supplied by the purchaser for the interaction.                                                                    |
| `inputHash`                  | string | Yes      | Hash commitment over the purchaser's inputs to the agent, as defined by Masumi.                                              |
| `payByTime`                  | string | Yes      | Unix timestamp (seconds, string-encoded) by which the purchaser must pay.                                                    |
| `submitResultTime`           | string | Yes      | Unix timestamp by which the seller must submit a result.                                                                     |
| `unlockTime`                 | string | Yes      | Unix timestamp at which funds become withdrawable by the seller absent dispute.                                              |
| `externalDisputeUnlockTime`  | string | Yes      | Unix timestamp at which an external dispute path unlocks, as defined by Masumi.                                              |

The exact semantics of these fields are governed by the Masumi protocol specification. This extension records their on-the-wire placement and requires echo behaviour; it does not re-specify Masumi's off-chain rules.

## Responsibilities

**Resource server:**
- MUST place Masumi-specific fields in `extensions["cardano-masumi"].info`.
- MUST NOT place Masumi-specific fields in `PaymentRequirements.extra` or the core `payload` object.
- SHOULD populate `payTo` with the Masumi script address and `extra` with the script reference so that clients unaware of the Masumi extension can still construct a script-parameterized payment following the core scheme.

**Client:**
- If the client recognises the `cardano-masumi` extension, it SHOULD use the Masumi-specific fields to construct a Masumi-compliant datum and redeemer.
- The client MUST echo the extension info back in `PaymentPayload.extensions["cardano-masumi"].info` unchanged.
- If the client does not recognise the extension, it MAY fall back to treating the payment as a generic script-parameterized Cardano payment, provided the server has also supplied `extra.script` / `extra.scriptHash` as required by the core scheme. Whether Masumi will ultimately accept such a payment is a Masumi-protocol matter, not an x402 matter.

**Facilitator:**
- A facilitator that does not implement `cardano-masumi` MUST still enforce the core Cardano verification rules (network, recipient, amount, asset, nonce, TTL).
- A facilitator that does implement `cardano-masumi` MAY additionally enforce Masumi-specific checks (for example, verifying the datum structure, time-window consistency, or seller verification key binding). Such checks MUST NOT be used to reject payments from servers that only declare the core scheme.

## Core Compatibility

This extension is designed so that a minimally conformant x402 stack — one that implements only the core Cardano `exact` scheme — can still process a Masumi payment as a generic script-parameterized payment:

- Recipient, amount, asset, nonce, and TTL checks are unchanged.
- The Masumi script address is visible in `payTo`.
- The Masumi script (or its hash) is visible in `extra`.
- The Masumi-specific fields are cleanly isolated under `extensions["cardano-masumi"]` and can be ignored without breaking verification.

A non-Masumi stack cannot, of course, reproduce Masumi's off-chain invariants (escrow windows, dispute rights, agent accounting). That is precisely what makes these fields extension-level rather than core-level.

## Settlement Response

On success, the `PAYMENT-RESPONSE` payload MAY include extension-specific information under `extensions["cardano-masumi"]`:

```json
{
  "success": true,
  "network": "cardano:mainnet",
  "transaction": "2f9a7b3c...",
  "extensions": {
    "status": "confirmed",
    "cardano-masumi": {
      "info": {
        "blockchainIdentifier": "blockchain_identifier"
      }
    }
  }
}
```

This extension does not currently specify additional normative fields in the settlement response; future versions MAY add them.

## End-to-End Example

This section shows a complete Masumi-routed flow using the Cardano `exact` scheme together with the `cardano-masumi` extension. All three messages — `PaymentRequired`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE` — are shown consistently.

For brevity, the signed transaction is truncated; in practice it is the Base64-encoded CBOR of a fully signed Cardano transaction that pays the declared `amount` of the declared `asset` to `payTo` (the Masumi script address) and consumes the UTXO referenced by `payload.nonce` as an input.

### Step 1 — `402 Payment Required` (server → client)

```json
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
      "payTo": "addr1wxmasumiscriptaddressexample000000000000000000000000000000000",
      "maxTimeoutSeconds": 600,
      "extra": {
        "scriptHash": "masumi_script_hash",
        "script": {
          "type": "plutusV3",
          "code": "<hex-encoded script code, if not on-chain>"
        },
        "parameters": {}
      }
    }
  ],
  "extensions": {
    "cardano-masumi": {
      "info": {
        "paymentType": "Web3CardanoV1",
        "blockchainIdentifier": "blockchain_identifier",
        "sellerVkey": "sdasdqweqwewewewqe",
        "agentIdentifier": "agent_identifier",
        "identifierFromPurchaser": "aabbaabb11221122aabb",
        "inputHash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        "payByTime": "1713626260",
        "submitResultTime": "1713636260",
        "unlockTime": "1713636260",
        "externalDisputeUnlockTime": "1713636260"
      },
      "schema": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "paymentType": { "type": "string" },
          "blockchainIdentifier": { "type": "string" },
          "sellerVkey": { "type": "string" },
          "agentIdentifier": { "type": "string" },
          "identifierFromPurchaser": { "type": "string" },
          "inputHash": { "type": "string" },
          "payByTime": { "type": "string" },
          "submitResultTime": { "type": "string" },
          "unlockTime": { "type": "string" },
          "externalDisputeUnlockTime": { "type": "string" }
        },
        "required": [
          "paymentType",
          "blockchainIdentifier",
          "sellerVkey",
          "agentIdentifier",
          "identifierFromPurchaser",
          "inputHash",
          "payByTime",
          "submitResultTime",
          "unlockTime",
          "externalDisputeUnlockTime"
        ]
      }
    }
  }
}
```

### Step 2 — `PAYMENT-SIGNATURE` header (client → server)

The client selects the offer above, builds and signs a Cardano transaction that pays the Masumi script address with a datum consistent with the Masumi fields, and submits it via the `PAYMENT-SIGNATURE` header. The decoded (pre-Base64) header payload is:

```json
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
    "payTo": "addr1wxmasumiscriptaddressexample000000000000000000000000000000000",
    "maxTimeoutSeconds": 600,
    "extra": {
      "scriptHash": "masumi_script_hash",
      "script": {
        "type": "plutusV3",
        "code": "<hex-encoded script code>"
      },
      "parameters": {}
    }
  },
  "payload": {
    "transaction": "AAAIAQDi1Hwj...AAAAAAA=",
    "nonce": "662cbf645fcd8914eb89115b83970a950493dd2fbaf39dea3b96e8cbdc132939#0"
  },
  "extensions": {
    "cardano-masumi": {
      "info": {
        "paymentType": "Web3CardanoV1",
        "blockchainIdentifier": "blockchain_identifier",
        "sellerVkey": "sdasdqweqwewewewqe",
        "agentIdentifier": "agent_identifier",
        "identifierFromPurchaser": "aabbaabb11221122aabb",
        "inputHash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        "payByTime": "1713626260",
        "submitResultTime": "1713636260",
        "unlockTime": "1713636260",
        "externalDisputeUnlockTime": "1713636260"
      },
      "schema": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "paymentType": { "type": "string" },
          "blockchainIdentifier": { "type": "string" },
          "sellerVkey": { "type": "string" },
          "agentIdentifier": { "type": "string" },
          "identifierFromPurchaser": { "type": "string" },
          "inputHash": { "type": "string" },
          "payByTime": { "type": "string" },
          "submitResultTime": { "type": "string" },
          "unlockTime": { "type": "string" },
          "externalDisputeUnlockTime": { "type": "string" }
        },
        "required": [
          "paymentType",
          "blockchainIdentifier",
          "sellerVkey",
          "agentIdentifier",
          "identifierFromPurchaser",
          "inputHash",
          "payByTime",
          "submitResultTime",
          "unlockTime",
          "externalDisputeUnlockTime"
        ]
      }
    }
  }
}
```

Notes on this step:

- The client MUST echo `extensions["cardano-masumi"].info` unchanged from what it received in Step 1 (per the v2 rule that the client may append but not delete or overwrite server-supplied extension info).
- The `extra` object still carries the generic script reference required by the core Cardano scheme; this is what allows a non-Masumi facilitator to verify the underlying payment independent of the extension.
- `payload.nonce` references a UTXO consumed as an input of the signed transaction, as required by the core scheme's replay-prevention rule.

### Step 3 — `PAYMENT-RESPONSE` / `SettlementResponse` (server → client, on success)

```json
{
  "success": true,
  "network": "cardano:mainnet",
  "transaction": "2f9a7b3c1d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff",
  "extensions": {
    "status": "confirmed",
    "cardano-masumi": {
      "info": {
        "blockchainIdentifier": "blockchain_identifier"
      }
    }
  }
}
```

Notes on this step:

- Core fields (`success`, `network`, `transaction`, `extensions.status`) follow the core Cardano scheme.
- The `cardano-masumi` settlement-extension payload echoes the `blockchainIdentifier` so clients and downstream consumers can correlate the on-chain tx with the Masumi off-chain payment stream. Future versions of this extension MAY specify additional settlement-side fields (e.g., Masumi state transitions); this example reflects the minimum required today.
- A non-Masumi-aware client receiving this response can still interpret the core fields correctly and SHOULD ignore `extensions["cardano-masumi"]`.

### What a non-Masumi-aware stack sees

A minimally conformant Cardano `exact` stack that does not implement the `cardano-masumi` extension processes the same flow as a generic script-parameterized Cardano payment:

- Recipient, amount, asset, nonce, and TTL checks apply to the transaction exactly as specified in the core scheme.
- The Masumi script address is visible in `payTo`; the Masumi script (or hash) is visible in `extra`.
- The `cardano-masumi` extension block is ignored.

Such a stack will not enforce Masumi's off-chain invariants (escrow timing, dispute windows, agent/seller accounting) — those are, by design, the exclusive responsibility of Masumi-aware implementations.

## Security Considerations

- This extension MUST NOT be used to weaken the core Cardano verification rules. In particular, possession of a valid Masumi datum does not substitute for the nonce/replay, TTL, or amount/asset checks.
- Implementers SHOULD treat Masumi-specific fields as untrusted off-chain assertions until validated against the Masumi protocol by an implementation that understands it.
- Facilitators that accept Masumi payments SHOULD clearly document which Masumi invariants they enforce and which they delegate to the resource server or the seller.

## Privacy Considerations

- Masumi identifiers (`agentIdentifier`, `identifierFromPurchaser`, `sellerVkey`) are identifying or near-identifying on an x402 wire. Implementations SHOULD treat them with the same care as other pseudonymous identifiers.
- Servers SHOULD NOT include Masumi extension fields in `PaymentRequired` responses for resources that do not actually route through Masumi.

## Version History

| Version | Date       | Changes                                                                       | Author   |
| ------- | ---------- | ----------------------------------------------------------------------------- | -------- |
| 0.1     | 2026-04-23 | Initial draft; moves Masumi-specific fields out of the core Cardano scheme.   | QBT Labs |
