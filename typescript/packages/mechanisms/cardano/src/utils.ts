import {
  Address,
  Data,
  Ed25519Signature,
  SlotConfig,
  Transaction,
  TransactionBody,
  TransactionHash,
  TxOut,
  VKey,
} from "@evolution-sdk/evolution";

import {
  CARDANO_ASSET_REGEX,
  CARDANO_MAINNET_CAIP2,
  CARDANO_MIN_UTXO_OVERHEAD_BYTES,
  CARDANO_PREPROD_CAIP2,
  CARDANO_PREVIEW_CAIP2,
  CARDANO_UTXO_REF_REGEX,
  normalizeCardanoNetwork,
} from "./constants";
import type { CardanoUtxoOutput, DecodedCardanoTransaction, ExactCardanoPayload } from "./types";

/**
 * Protocol minimum lovelace for a transaction output of the given CBOR-serialized
 * size: `(overhead + serializedSize) * coinsPerUtxoByte` (Babbage/Conway rule).
 *
 * @param serializedSize - Byte length of the CBOR-serialized output.
 * @param coinsPerUtxoByte - The `coinsPerUtxoByte` protocol parameter.
 * @returns The minimum lovelace the output must carry.
 */
export function minUtxoLovelace(serializedSize: number, coinsPerUtxoByte: bigint): bigint {
  return BigInt(CARDANO_MIN_UTXO_OVERHEAD_BYTES + serializedSize) * coinsPerUtxoByte;
}

/** Evolution slot-config preset per Cardano network (Praos slot <-> wall-clock). */
const SLOT_CONFIG_BY_NETWORK: Record<string, (typeof SlotConfig.SLOT_CONFIG_NETWORK)["Mainnet"]> = {
  [CARDANO_MAINNET_CAIP2]: SlotConfig.SLOT_CONFIG_NETWORK.Mainnet,
  [CARDANO_PREPROD_CAIP2]: SlotConfig.SLOT_CONFIG_NETWORK.Preprod,
  [CARDANO_PREVIEW_CAIP2]: SlotConfig.SLOT_CONFIG_NETWORK.Preview,
};

/**
 * Converts an absolute slot to POSIX milliseconds for a Cardano network, so a
 * transaction's validity upper bound (a slot) can be compared against a datum
 * timestamp (POSIX ms), e.g. the Masumi `pay_by_time` deadline.
 *
 * @param network - The x402 Cardano network identifier (or a CIP-34 alias).
 * @param slot - The absolute slot number.
 * @returns The wall-clock time of the slot in POSIX milliseconds.
 */
export function slotToPosixMs(network: string, slot: bigint): number {
  const cfg = SLOT_CONFIG_BY_NETWORK[normalizeCardanoNetwork(network)];
  if (!cfg) {
    throw new Error(`No slot config for network: ${network}`);
  }
  return Number(cfg.zeroTime) + (Number(slot) - Number(cfg.zeroSlot)) * cfg.slotLength;
}

/**
 * Splits a Cardano asset unit (`policyId.assetNameHex`) into its components.
 *
 * @param asset - The asset unit string.
 * @returns The parsed policy id and asset name.
 */
export function parseAssetUnit(asset: string): { policyId: string; assetNameHex: string } {
  if (!CARDANO_ASSET_REGEX.test(asset)) {
    throw new Error(`Invalid Cardano asset unit: ${asset}`);
  }
  if (asset.toLowerCase() === "lovelace") {
    return { policyId: "", assetNameHex: "" };
  }
  const [policyId, assetNameHex] = asset.split(".");
  return { policyId: policyId.toLowerCase(), assetNameHex: assetNameHex.toLowerCase() };
}

/**
 * Parses a UTXO reference (`txHashHex#index`).
 *
 * @param ref - The UTXO reference.
 * @returns The parsed transaction hash and output index.
 */
export function parseUtxoRef(ref: string): { txHash: string; index: number } {
  if (!CARDANO_UTXO_REF_REGEX.test(ref)) {
    throw new Error(`Invalid Cardano UTXO reference: ${ref}`);
  }
  const [txHash, indexStr] = ref.split("#");
  return { txHash: txHash.toLowerCase(), index: parseInt(indexStr, 10) };
}

/**
 * Reads a Cardano payment payload back out of an arbitrary record.
 *
 * @param raw - The raw payload coming from the x402 envelope.
 * @returns The typed Cardano payload.
 */
export function decodeCardanoPayload(raw: Record<string, unknown>): ExactCardanoPayload {
  const transaction = raw.transaction;
  const nonce = raw.nonce;
  if (typeof transaction !== "string" || transaction.length === 0) {
    throw new Error("Cardano payload is missing a transaction string");
  }
  if (typeof nonce !== "string" || nonce.length === 0) {
    throw new Error("Cardano payload is missing a nonce string");
  }
  return { transaction, nonce };
}

/**
 * Decodes a base64-encoded signed Cardano transaction into a structural
 * summary using Intersect's Evolution SDK. Only the fields required by the
 * facilitator's `verify()` path are surfaced.
 *
 * @param transactionBase64 - The base64-encoded CBOR transaction.
 * @returns The decoded transaction summary.
 */
export function decodeCardanoTransaction(transactionBase64: string): DecodedCardanoTransaction {
  const txBytes = Uint8Array.from(Buffer.from(transactionBase64, "base64"));
  const tx = Transaction.fromCBORBytes(txBytes);

  // Hash the raw CBOR body bytes (blake2b-256). `extractBodyBytes` preserves
  // the exact on-wire encoding so the digest matches what the chain reports.
  const bodyBytes = Transaction.extractBodyBytes(txBytes);
  const bodyHash = TransactionBody.toHashFromBytes(bodyBytes);
  const txHash = TransactionHash.toHex(bodyHash);
  const bodyHashBytes = TransactionHash.toBytes(bodyHash);

  const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex").toLowerCase();

  const inputs = tx.body.inputs.map(
    input => `${toHex(input.transactionId.hash)}#${Number(input.index)}`,
  );

  const outputs: CardanoUtxoOutput[] = tx.body.outputs.map(out => {
    const address = Address.toBech32(out.address);
    const assets: Record<string, bigint> = {};
    if (out.assets.multiAsset) {
      for (const [policyId, innerMap] of out.assets.multiAsset.map) {
        const policyHex = toHex(policyId.hash);
        for (const [assetName, qty] of innerMap) {
          const nameHex = toHex(assetName.bytes);
          assets[`${policyHex}.${nameHex}`] = qty;
        }
      }
    }
    const datumOption = (out as { datumOption?: { _tag: string; data: Data.Data } }).datumOption;
    const datum =
      datumOption && datumOption._tag === "InlineDatum"
        ? Data.toCBORHex(datumOption.data)
        : undefined;
    const serializedSize = TxOut.toCBORBytes(out).length;
    const hasReferenceScript = (out as { scriptRef?: unknown }).scriptRef !== undefined;
    return {
      address,
      coin: out.assets.lovelace,
      assets,
      datum,
      serializedSize,
      hasReferenceScript,
    };
  });

  const ws = tx.witnessSet;
  const vkeyWitnessCount = (ws.vkeyWitnesses?.length ?? 0) + (ws.bootstrapWitnesses?.length ?? 0);
  const scriptWitnessCount =
    (ws.nativeScripts?.length ?? 0) +
    (ws.plutusV1Scripts?.length ?? 0) +
    (ws.plutusV2Scripts?.length ?? 0) +
    (ws.plutusV3Scripts?.length ?? 0) +
    (ws.redeemers ? ws.redeemers.size : 0);

  // Cryptographically verify every vkey witness signs the body hash, so verify()
  // can reject a transaction carrying a forged or stale signature that could
  // never settle. Bootstrap (Byron) witnesses are out of scope for this scheme.
  const signaturesValid = (ws.vkeyWitnesses ?? []).every(witness =>
    VKey.verify(witness.vkey, bodyHashBytes, Ed25519Signature.toBytes(witness.signature)),
  );

  return {
    txHash,
    networkId: tx.body.networkId,
    ttlSlot: tx.body.ttl,
    validityStartSlot: tx.body.validityIntervalStart,
    inputs,
    outputs,
    vkeyWitnessCount,
    scriptWitnessCount,
    signaturesValid,
  };
}
