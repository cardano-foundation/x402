/**
 * Payload structure carried inside a Cardano `exact` PaymentPayload.
 *
 * The `transaction` field is a base64-encoded, fully signed Cardano CBOR
 * transaction. The `nonce` field is a UTXO reference (`txHashHex#index`) that
 * MUST also appear as one of the transaction inputs. The facilitator uses the
 * nonce to enforce uniqueness and replay protection (rule 5 in the spec).
 */
export type ExactCardanoPayload = {
  /**
   * Base64 encoded fully signed Cardano transaction (CBOR).
   */
  transaction: string;
  /**
   * UTXO reference (`txHash#index`) used as nonce, must be present as a tx input.
   */
  nonce: string;
};

/**
 * Common (default) `extra` shape for Cardano payment requirements.
 *
 * The default assetTransferMethod is the address-to-address flow described in
 * the spec — `extra` may be empty or carry caller-defined metadata.
 */
export interface CardanoExtraDefault {
  /**
   * Free-form metadata. Implementations MUST tolerate unknown keys.
   */
  [key: string]: unknown;
  /**
   * Optional explicit method marker. Defaults to "default" when missing.
   */
  assetTransferMethod?: "default";
}

/**
 * `extra` shape for the Masumi assetTransferMethod — the fields needed to build
 * the Masumi `vested_pay` escrow lock datum. Field semantics follow the spec
 * section "Masumi assetTransferMethod Schema"; each maps to a datum field.
 *
 * Fields split by who knows them:
 *
 * - **Server-declared (required)** — the seller-side identifiers and time bounds
 *   the resource server takes from its Masumi payment request. They bind the
 *   locked UTxO to that purchase, so the client must not invent them and the
 *   facilitator matches every one against the datum.
 * - **Buyer-supplied (optional here)** — `identifierFromPurchaser`, `inputHash`
 *   and `buyerReturnAddress`. The 402 is issued for an unauthenticated request,
 *   so the server cannot know them; the client fills them when it builds the
 *   lock. A server that does declare one is still honoured and matched.
 */
export interface CardanoExtraMasumi {
  /**
   * Free-form additional metadata.
   */
  [key: string]: unknown;
  /**
   * Method marker selecting Masumi semantics.
   */
  assetTransferMethod: "masumi";
  /**
   * Masumi `PaymentSourceType` — selects the contract generation
   * (`Web3CardanoV2` = the `vested_pay` payment-v2 escrow).
   */
  paymentType?: string;
  /**
   * Escrow (`vested_pay`) script address for this Masumi deployment, from the
   * purchase. **Required** and must equal `payTo`: a script address is
   * deployment-specific (its parameters are baked into the hash), so it cannot
   * be safely defaulted — locking to a wrong escrow silently strands the funds.
   * For Masumi's canonical deployment, {@link masumiContractAddress} computes it.
   */
  contractAddress: string;
  /**
   * Full seller address (public-key credential); datum `seller`.
   */
  sellerAddress: string;
  /**
   * Optional payout destination; datum `seller_return_address`.
   */
  sellerReturnAddress?: string;
  /**
   * datum `buyer_return_address`. **Buyer-chosen** — the resource server does
   * not know the payer when it issues the 402, so the client fills it, and the
   * facilitator never matches it against `extra` (unlike `sellerReturnAddress`).
   * The buyer stays bound by the `buyer` = payer rule instead.
   */
  buyerReturnAddress?: string;
  /**
   * datum `reference_key` (hex) — from the Masumi purchase.
   */
  referenceKey: string;
  /**
   * datum `reference_signature` (hex; >= 16 bytes) — from the Masumi purchase.
   */
  referenceSignature: string;
  /**
   * datum `buyer_nonce` (hex). **Buyer-supplied**, for the same reason as
   * {@link CardanoExtraMasumi.buyerReturnAddress}: it comes from the buyer's
   * purchase, which is created *after* the 402. The client fills it (from its
   * Masumi purchase, or a fresh random nonce). A server that already knows the
   * purchase may declare it, and the facilitator then matches it.
   */
  identifierFromPurchaser?: string;
  /**
   * datum `seller_nonce` (hex) — from the Masumi purchase.
   */
  sellerNonce: string;
  /**
   * datum `agent_identifier` (hex) — the registered Masumi agent.
   */
  agentIdentifier: string;
  /**
   * datum `input_hash` (hex) — hash of the job input the buyer sends the agent,
   * so it is **buyer-supplied** too. Defaults to empty when neither side sets it.
   */
  inputHash?: string;
  /**
   * datum `collateral_return_lovelace` (decimal string; >= 0). Optional;
   * defaults to 0 when absent.
   */
  collateralReturnLovelace?: string;
  /**
   * Time bounds as POSIX **milliseconds** (decimal strings) from the Masumi
   * purchase, ordered `payByTime <= submitResultTime <= unlockTime <=
   * externalDisputeUnlockTime`.
   */
  payByTime: string;
  submitResultTime: string;
  unlockTime: string;
  externalDisputeUnlockTime: string;
}

/**
 * Plutus script descriptor used in the script assetTransferMethod.
 */
export interface CardanoScriptDescriptor {
  /**
   * The script type: only Plutus script types are valid.
   */
  type: "plutusV1" | "plutusV2" | "plutusV3";
  /**
   * Hex-encoded script bytes.
   */
  code: string;
}

/**
 * One parameter applied to a Plutus script during transaction building.
 */
export interface CardanoScriptParameter {
  /**
   * The PlutusData primitive type.
   */
  type: "bytes" | "bigint" | "integer" | "string" | "constr" | "list" | "map" | "boolean";
  /**
   * The parameter value. Encoding is `type`-specific.
   */
  value: unknown;
}

/**
 * `extra` shape for the script assetTransferMethod.
 */
export interface CardanoExtraScript {
  /**
   * Free-form additional metadata.
   */
  [key: string]: unknown;
  /**
   * Method marker selecting script semantics.
   */
  assetTransferMethod: "script";
  /**
   * Hash of the script as published on-chain (optional if `script` is inlined).
   */
  scriptHash?: string;
  /**
   * Inlined script body (optional if `scriptHash` is provided).
   */
  script?: CardanoScriptDescriptor;
  /**
   * Parameters that are applied to the script during transaction building.
   * Maps parameter name to its value descriptor.
   */
  parameters?: Record<string, CardanoScriptParameter>;
  /**
   * Optional Plutus datum (CBOR hex) to attach to the `payTo` output as an
   * INLINE datum. Supply this to lock funds into a contract that requires a
   * datum — the script method is fully general and not tied to any specific
   * contract, so the datum is whatever the target validator expects.
   *
   * The facilitator does NOT verify the datum's contents: it is arbitrary and
   * contract-specific, so only the server that defined the contract can judge
   * its correctness. A datum the target validator does not accept strands the
   * locked funds, so providing a correct datum is the server's responsibility.
   * Omit for scripts that spend without a datum (e.g. a PlutusV3 validator
   * written for the `None` case). Inline only — datum-hash outputs (required to
   * later spend a PlutusV1 script) are out of scope for this method.
   */
  datum?: string;
}

/**
 * Discriminated union of every supported `extra` shape for Cardano.
 */
export type CardanoExtra = CardanoExtraDefault | CardanoExtraMasumi | CardanoExtraScript;

/**
 * Lightweight description of a UTXO output kept in flight memory so that the
 * facilitator can perform input/asset checks without depending on a particular
 * Cardano SDK type.
 */
export interface CardanoUtxoOutput {
  /**
   * The bech32 payment address that owns this UTXO.
   */
  address: string;
  /**
   * Quantity of lovelace (ADA) attached to the UTXO.
   */
  coin: bigint;
  /**
   * Map of `policyId.assetNameHex` -> quantity for native tokens.
   */
  assets: Record<string, bigint>;
  /**
   * CBOR hex of the output's inline datum, when present. Used by the facilitator
   * to verify script/escrow payments (e.g. the Masumi lock datum).
   */
  datum?: string;
  /**
   * Byte length of the CBOR-serialized output. Used by the facilitator to check
   * the output satisfies the protocol min-UTXO. Present for decoded transactions.
   */
  serializedSize?: number;
  /**
   * True when the output carries a reference script (`script_ref`). The Masumi
   * escrow output must not — a set one is treated as a spoofing attempt.
   */
  hasReferenceScript?: boolean;
}

/**
 * Decoded view of the relevant fields from a Cardano transaction body.
 *
 * Used by the facilitator's verifier so the heavy CBOR decoding lives in one
 * place behind a stable shape.
 */
export interface DecodedCardanoTransaction {
  /**
   * Hex-encoded transaction hash (BLAKE2b-256 of the body).
   */
  txHash: string;
  /**
   * Network ID embedded in the transaction body (1 = mainnet, 0 = testnet),
   * or `undefined` if absent.
   */
  networkId?: number;
  /**
   * TTL slot number, or `undefined` if no TTL is set.
   */
  ttlSlot?: bigint;
  /**
   * `validityStart` slot number (lower bound), or `undefined` if absent.
   */
  validityStartSlot?: bigint;
  /**
   * Transaction inputs as ordered UTXO references (`txHashHex#index`).
   */
  inputs: string[];
  /**
   * Decoded outputs in declaration order.
   */
  outputs: CardanoUtxoOutput[];
  /**
   * Number of vkey + bootstrap witnesses present in the transaction. Used by
   * the facilitator to refuse unsigned transactions in `verify()`.
   */
  vkeyWitnessCount: number;
  /**
   * Number of script witnesses (native + plutus) present. A script-mode
   * payment must carry at least one redeemer; for default/Masumi payments
   * either vkey or bootstrap witnesses suffice.
   */
  scriptWitnessCount: number;
  /**
   * True when every vkey witness carries a valid Ed25519 signature over the
   * transaction body hash. False signals a forged or stale signature that the
   * chain would reject at submission.
   */
  signaturesValid: boolean;
  /**
   * Index of the auxiliary data hash, if any (kept for parity with future
   * additions; unused today).
   */
  auxiliaryDataHash?: string;
}
