import {
  Address,
  Assets,
  type Chain,
  Client,
  mainnet,
  preprod,
  preview,
  Transaction,
  TransactionHash,
  TransactionInput,
} from "@evolution-sdk/evolution";
import { addressFromSeed } from "@evolution-sdk/evolution/sdk/wallet/Derivation";

import {
  CARDANO_MAINNET_CAIP2,
  CARDANO_PREPROD_CAIP2,
  CARDANO_PREVIEW_CAIP2,
  LOVELACE_ASSET,
} from "./constants";
import { parseAssetUnit, parseUtxoRef } from "./utils";

/**
 * Provider connection used by the reference signers. Exactly one of
 * `blockfrost` or `koios` must be supplied. These map directly onto the
 * Evolution SDK provider configs.
 */
export type CardanoProviderConfig =
  | { blockfrost: { baseUrl: string; projectId?: string }; koios?: never }
  | { koios: { baseUrl: string; token?: string }; blockfrost?: never };

/**
 * Resolves an x402 Cardano network identifier to an Evolution SDK chain preset.
 *
 * @param network - The x402 network identifier (e.g. "cardano:mainnet").
 * @returns The matching Evolution SDK chain preset.
 */
function resolveChain(network: string): Chain {
  switch (network) {
    case CARDANO_MAINNET_CAIP2:
      return mainnet;
    case CARDANO_PREPROD_CAIP2:
      return preprod;
    case CARDANO_PREVIEW_CAIP2:
      return preview;
    default:
      throw new Error(`Unsupported Cardano network: ${network}`);
  }
}

/**
 * Normalizes a BIP-39 mnemonic: trims, collapses internal whitespace, and
 * lowercases it. The BIP-39 word list is all lowercase, so this recovers the
 * correct wallet from a mnemonic that picked up stray capitalization or extra
 * whitespace (e.g. when copied into an env file) instead of failing derivation.
 *
 * @param mnemonic - The raw mnemonic phrase.
 * @returns The normalized mnemonic.
 */
function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Attaches the configured provider to a chain-scoped client assembly.
 *
 * @param assembly - The chain-scoped client assembly.
 * @param provider - The provider connection config.
 * @returns A read-capable client.
 */
function withProvider(
  assembly: ReturnType<typeof Client.make>,
  provider: CardanoProviderConfig,
): ReturnType<ReturnType<typeof Client.make>["withBlockfrost"]> {
  if (provider.blockfrost) {
    return assembly.withBlockfrost(provider.blockfrost);
  }
  return assembly.withKoios(provider.koios);
}

/**
 * Builds the payment-output assets for the requested asset/amount. Lovelace
 * lives in the output coin; native assets live in the multi-asset map.
 *
 * @param asset - The asset unit (`lovelace` or `policyId.assetNameHex`).
 * @param amount - The amount in the asset's smallest unit.
 * @returns Evolution SDK assets describing the output value.
 */
function buildOutputAssets(asset: string, amount: bigint): Assets.Assets {
  if (asset.toLowerCase() === LOVELACE_ASSET) {
    return Assets.fromLovelace(amount);
  }
  const { policyId, assetNameHex } = parseAssetUnit(asset);
  // Native-asset outputs still require lovelace; build() bumps it to the
  // protocol minimum when autoMinUtxo is enabled.
  return Assets.addByHex(Assets.zero, policyId, assetNameHex, amount);
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
  buildAndSignPaymentTransaction(
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
   * the spec's six rules have passed. This evaluates Plutus script execution
   * units only (Ogmios evaluateTransaction / Blockfrost /utils/txs/evaluate);
   * it does NOT validate vkey signatures and is a no-op for simple
   * address-to-address payments. vkey-signature authorization is enforced by
   * the node at submit time (settle), per the eUTXO model.
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

/**
 * Configuration for the reference {@link toClientCardanoSigner} factory.
 */
export interface ClientCardanoSignerConfig {
  /**
   * BIP-39 mnemonic controlling the funding wallet.
   */
  mnemonic: string;
  /**
   * The x402 network identifier (one of `CARDANO_NETWORKS`).
   */
  network: string;
  /**
   * Provider connection used to read wallet UTXOs and protocol parameters.
   */
  provider: CardanoProviderConfig;
  /**
   * Optional account index for key derivation. Defaults to 0.
   */
  accountIndex?: number;
}

/**
 * Builds a reference {@link ClientCardanoSigner} backed by the Evolution SDK.
 *
 * The signer picks a wallet UTXO as the replay-protection nonce, pays the
 * requested asset/amount to `payTo`, sets the transaction TTL from
 * `maxTimeoutSeconds`, signs offline, and returns the base64 signed CBOR plus
 * the chosen UTXO reference. The returned transaction satisfies the
 * facilitator's `verify()` rules: the nonce appears as an input, an output
 * pays the requested asset/amount, and at least one vkey witness is present.
 *
 * @param config - The client signer configuration.
 * @returns A ready-to-use client signer.
 */
export function toClientCardanoSigner(config: ClientCardanoSignerConfig): ClientCardanoSigner {
  const chain = resolveChain(config.network);
  const mnemonic = normalizeMnemonic(config.mnemonic);
  const client = withProvider(Client.make(chain), config.provider).withSeed({
    mnemonic,
    accountIndex: config.accountIndex,
  });

  // Derive the funding address synchronously so getAddress() needs no await.
  const address = Address.toBech32(
    addressFromSeed(mnemonic, {
      accountIndex: config.accountIndex,
      networkId: chain.id,
    }).address,
  );

  return {
    getAddress(): string {
      return address;
    },

    async buildAndSignPaymentTransaction(
      input: ClientCardanoSignInput,
    ): Promise<ClientCardanoSignResult> {
      if (input.network !== config.network) {
        throw new Error(
          `Signer configured for ${config.network} but asked to pay on ${input.network}`,
        );
      }

      const changeAddress = await client.address();
      const utxos = await client.getWalletUtxos();
      if (utxos.length === 0) {
        throw new Error("Funding wallet has no UTXOs available for the payment");
      }
      // Use the first wallet UTXO as the nonce; collectFrom forces it to appear
      // as a transaction input (verification rule 5).
      const nonceUtxo = utxos[0];
      const nonceTxHash = Buffer.from(nonceUtxo.transactionId.hash).toString("hex").toLowerCase();
      const nonce = `${nonceTxHash}#${Number(nonceUtxo.index)}`;

      const outputAssets = buildOutputAssets(input.asset, BigInt(input.amount));
      const ttlMs = BigInt(Date.now()) + BigInt(input.maxTimeoutSeconds) * 1000n;

      const signBuilder = await client
        .newTx()
        // .collectFrom() with a specific UTXO ensures the nonce appears as an input (rule 5).
        // Additional UTXOs from the wallet may be auto-selected as needed to satisfy the output and fees.
        .collectFrom({ inputs: [nonceUtxo] })
        .payToAddress({ address: Address.fromBech32(input.payTo), assets: outputAssets })
        .setValidity({ to: ttlMs })
        .build({
          changeAddress,
          autoMinUtxo: input.asset.toLowerCase() !== LOVELACE_ASSET,
        });

      const submitBuilder = await signBuilder.sign();
      const unsigned = await signBuilder.toTransaction();
      const signed = new Transaction.Transaction({
        body: unsigned.body,
        witnessSet: submitBuilder.witnessSet,
        isValid: true,
        auxiliaryData: null,
      });

      return {
        transaction: Buffer.from(Transaction.toCBORBytes(signed)).toString("base64"),
        nonce,
      };
    },
  };
}

/**
 * Configuration for the reference {@link toFacilitatorCardanoSigner} factory.
 */
export interface FacilitatorCardanoSignerConfig {
  /**
   * Optional BIP-39 mnemonic. The facilitator only broadcasts the client's
   * already-signed transaction (the client pays the network fee), so it needs no
   * funds and no signing key. When supplied, its address is exposed via
   * `getAddresses` for the `/supported` response; when omitted the facilitator
   * runs provider-only and `getAddresses` returns an empty list.
   */
  mnemonic?: string;
  /**
   * The x402 network identifier (one of `CARDANO_NETWORKS`).
   */
  network: string;
  /**
   * Provider connection used for chain lookups and submission.
   */
  provider: CardanoProviderConfig;
  /**
   * Optional account index for key derivation. Defaults to 0.
   */
  accountIndex?: number;
  /**
   * When `true` (default), `submitTransaction` awaits on-chain confirmation
   * before reporting `status: "confirmed"`. Set to `false` to return
   * `status: "mempool"` immediately after broadcast — note the facilitator
   * scheme rejects mempool-only settlements unless `acceptMempool` is enabled.
   */
  awaitConfirmation?: boolean;
}

/**
 * Builds a reference {@link FacilitatorCardanoSigner} backed by the Evolution
 * SDK provider for chain queries and transaction submission.
 *
 * @param config - The facilitator signer configuration.
 * @returns A ready-to-use facilitator signer.
 */
export function toFacilitatorCardanoSigner(
  config: FacilitatorCardanoSignerConfig,
): FacilitatorCardanoSigner {
  const chain = resolveChain(config.network);
  const providerClient = withProvider(Client.make(chain), config.provider);
  const slotConfig = chain.slotConfig;

  // The facilitator only broadcasts the client's already-signed transaction and
  // queries the chain — both are provider operations. A mnemonic is optional and
  // used solely to expose an address via getAddresses() for the /supported
  // response; without it the facilitator runs provider-only (no funds, no signer).
  const mnemonic = config.mnemonic ? normalizeMnemonic(config.mnemonic) : undefined;
  const client = mnemonic
    ? providerClient.withSeed({ mnemonic, accountIndex: config.accountIndex })
    : providerClient;
  const addresses: readonly string[] = mnemonic
    ? [
        Address.toBech32(
          addressFromSeed(mnemonic, {
            accountIndex: config.accountIndex,
            networkId: chain.id,
          }).address,
        ),
      ]
    : [];

  const assertNetwork = (network: string): void => {
    if (network !== config.network) {
      throw new Error(`Signer configured for ${config.network} but asked about ${network}`);
    }
  };

  return {
    getAddresses(): readonly string[] {
      return addresses;
    },

    async getUtxo(ref: string, network: string): Promise<CardanoUtxoSnapshot> {
      assertNetwork(network);
      const { txHash, index } = parseUtxoRef(ref);
      const input = new TransactionInput.TransactionInput({
        transactionId: TransactionHash.fromHex(txHash),
        index: BigInt(index),
      });
      const utxos = await client.getUtxosByOutRef([input]);
      if (utxos.length === 0) {
        return { exists: false };
      }
      return { exists: true, address: Address.toBech32(utxos[0].address) };
    },

    async getCurrentSlot(network: string): Promise<bigint> {
      assertNetwork(network);
      // SlotConfig.zeroTime and slotLength are both in milliseconds for the
      // Evolution presets: slot = zeroSlot + floor((nowMs - zeroTime) / slotLength).
      const elapsedSlots = Math.floor(
        (Date.now() - Number(slotConfig.zeroTime)) / slotConfig.slotLength,
      );
      return slotConfig.zeroSlot + BigInt(elapsedSlots);
    },

    async submitTransaction(
      signedTransactionBase64: string,
      network: string,
    ): Promise<CardanoSubmissionResult> {
      assertNetwork(network);
      const tx = Transaction.fromCBORBytes(
        Uint8Array.from(Buffer.from(signedTransactionBase64, "base64")),
      );
      const hash = await client.submitTx(tx);
      const txHash = Buffer.from(hash.hash).toString("hex").toLowerCase();
      if (config.awaitConfirmation === false) {
        return { txHash, status: "mempool" };
      }
      await client.awaitTx(hash);
      return { txHash, status: "confirmed" };
    },

    async waitForConfirmation(txHash: string, network: string): Promise<void> {
      assertNetwork(network);
      await client.awaitTx(TransactionHash.fromHex(txHash));
    },

    async evaluateTransaction(signedTransactionBase64: string, network: string): Promise<void> {
      assertNetwork(network);
      const tx = Transaction.fromCBORBytes(
        Uint8Array.from(Buffer.from(signedTransactionBase64, "base64")),
      );
      await client.evaluateTx(tx);
    },
  };
}
