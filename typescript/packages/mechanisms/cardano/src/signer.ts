/**
 * Configuration for the client-side signer.
 */
export interface ClientCardanoConfig {
  /**
   * Optional custom RPC / chain query URL used by the client (e.g. a Blockfrost
   * or Koios endpoint).
   */
  rpcUrl?: string;
}

/**
 * Client-side signer protocol for Cardano.
 *
 * Implementations integrate the user's wallet / key management. The signer
 * receives the desired payment requirements and returns a base64-encoded
 * signed Cardano transaction along with the UTXO reference used as nonce.
 */
export interface ClientCardanoSigner {
  /**
   * Returns the bech32 address that will fund the payment.
   *
   * @returns The bech32 payment address.
   */
  getAddress(): string;

  /**
   * Builds and signs a Cardano transaction satisfying the supplied payment
   * requirements. The implementation MUST return both the signed CBOR
   * transaction (base64) and the UTXO reference it consumed for replay
   * protection. The chosen UTXO MUST appear as a transaction input.
   *
   * @param input - Payment building parameters.
   * @returns A promise resolving to the signed transaction and nonce.
   */
  signPaymentTransaction(
    input: ClientCardanoSignInput,
  ): Promise<ClientCardanoSignResult> | ClientCardanoSignResult;
}

/**
 * Inputs forwarded to a client signer when constructing a payment.
 */
export interface ClientCardanoSignInput {
  /**
   * The x402 network identifier (e.g. "cardano:mainnet").
   */
  network: string;
  /**
   * The recipient bech32 address.
   */
  payTo: string;
  /**
   * The asset unit (`policyId.assetNameHex`).
   */
  asset: string;
  /**
   * The amount in the asset's smallest unit, as a string.
   */
  amount: string;
  /**
   * Maximum lifetime of the transaction in seconds.
   */
  maxTimeoutSeconds: number;
  /**
   * The full `extra` block coming from the payment requirements (includes
   * assetTransferMethod and any method-specific metadata).
   */
  extra?: Record<string, unknown>;
}

/**
 * Result returned by a client signer.
 */
export interface ClientCardanoSignResult {
  /**
   * Base64 encoded signed Cardano transaction (CBOR).
   */
  transaction: string;
  /**
   * UTXO reference (`txHashHex#index`) used as nonce. MUST appear as a tx input.
   */
  nonce: string;
}

/**
 * Status returned by the chain layer for a settled / submitted transaction.
 */
export type CardanoSettlementStatus = "confirmed" | "mempool";

/**
 * Result of submitting a transaction via a facilitator signer.
 */
export interface CardanoSubmissionResult {
  /**
   * Hex transaction hash returned by the chain layer.
   */
  txHash: string;
  /**
   * Settlement status as defined by the spec ("confirmed" recommended;
   * "mempool" is permitted but strongly discouraged).
   */
  status: CardanoSettlementStatus;
}

/**
 * Lightweight UTXO summary returned by the facilitator's chain query layer.
 */
export interface CardanoUtxoSnapshot {
  /**
   * Whether the UTXO currently exists in the chain's UTXO set (i.e. is unspent).
   */
  exists: boolean;
  /**
   * Optional bech32 address that controls the UTXO. Useful for diagnostics.
   */
  address?: string;
}

/**
 * Facilitator-side signer / chain-query protocol for Cardano.
 *
 * Verification rule 5 of the spec requires confirming that the nonce UTXO
 * exists in the on-chain UTXO set. Verification rule 6 needs the current slot
 * to compare against the transaction's TTL. Settlement (step 6 of the
 * protocol) needs to submit the transaction. All of these are abstracted
 * behind this protocol so the mechanism remains agnostic to the specific
 * Cardano chain provider (Blockfrost, Koios, Yaci-Store, Ogmios, etc.).
 */
export interface FacilitatorCardanoSigner {
  /**
   * Returns all addresses managed by this facilitator. Useful for producing
   * the `signers` field of the `/supported` response.
   *
   * @returns An array of bech32 addresses.
   */
  getAddresses(): readonly string[];

  /**
   * Looks up a single UTXO by reference.
   *
   * Implementations SHOULD return `{ exists: false }` when the UTXO has been
   * spent or never existed, and rethrow / let exceptions propagate when the
   * lookup itself fails (network error, unknown chain, …).
   *
   * @param ref - The UTXO reference (`txHashHex#index`).
   * @param network - The x402 network identifier.
   * @returns A snapshot describing the UTXO presence.
   */
  getUtxo(ref: string, network: string): Promise<CardanoUtxoSnapshot>;

  /**
   * Returns the current absolute slot number for the supplied network.
   *
   * @param network - The x402 network identifier.
   * @returns The current absolute slot.
   */
  getCurrentSlot(network: string): Promise<bigint>;

  /**
   * Submits a fully signed transaction to the chain. Implementations MAY wait
   * for confirmation; if they do not, they SHOULD return `status: "mempool"`
   * and the facilitator will surface that to the client (the spec discourages
   * granting access on `mempool`).
   *
   * @param signedTransactionBase64 - The base64-encoded CBOR transaction.
   * @param network - The x402 network identifier.
   * @returns The submission result.
   */
  submitTransaction(
    signedTransactionBase64: string,
    network: string,
  ): Promise<CardanoSubmissionResult>;

  /**
   * Optional: waits for confirmation of a previously submitted transaction.
   * Implementations that already wait inside `submitTransaction` may return
   * immediately.
   *
   * @param txHash - The hex transaction hash to wait for.
   * @param network - The x402 network identifier.
   * @returns A promise that resolves once the transaction is confirmed.
   */
  waitForConfirmation?(txHash: string, network: string): Promise<void>;

  /**
   * Optional: ask a Cardano node / evaluation service to dry-run the signed
   * transaction. When implemented, the facilitator's `verify()` calls it after
   * the spec's six rules have passed; a successful dry-run proves the
   * signatures actually authorize the consumed inputs (the witness-count
   * check alone only proves witness material is present).
   *
   * Implementations should throw on any rejection. The thrown error is
   * surfaced as `invalid_message` on the verify response.
   *
   * @param signedTransactionBase64 - The base64-encoded CBOR transaction.
   * @param network - The x402 network identifier.
   * @returns A promise that resolves on a successful dry-run.
   */
  evaluateTransaction?(signedTransactionBase64: string, network: string): Promise<void>;
}
