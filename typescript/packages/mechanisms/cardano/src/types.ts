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
 * `extra` shape for the Masumi assetTransferMethod (Masumi smart protocol).
 *
 * Field semantics follow the spec section "Masumi assetTransferMethod Schema".
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
   * Identifier supplied by the purchaser (Masumi flow).
   */
  identifierFromPurchaser: string;
  /**
   * Verification key of the seller (Masumi flow).
   */
  sellerVkey: string;
  /**
   * Masumi payment type discriminator (e.g. "Web3CardanoV1").
   */
  paymentType: string;
  /**
   * Blockchain-side identifier for this purchase.
   */
  blockchainIdentifier: string;
  /**
   * Unix timestamp (seconds) by which payment must be made.
   */
  payByTime: string;
  /**
   * Unix timestamp (seconds) by which the seller must submit the result.
   */
  submitResultTime: string;
  /**
   * Unix timestamp (seconds) at which funds unlock.
   */
  unlockTime: string;
  /**
   * Unix timestamp (seconds) for the external dispute window.
   */
  externalDisputeUnlockTime: string;
  /**
   * Identifier of the providing agent.
   */
  agentIdentifier: string;
  /**
   * Hash of the input data (hex).
   */
  inputHash: string;
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
   * Index of the auxiliary data hash, if any (kept for parity with future
   * additions; unused today).
   */
  auxiliaryDataHash?: string;
}
