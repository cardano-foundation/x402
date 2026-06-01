import { Address, Transaction, TransactionBody, TransactionHash } from "@evolution-sdk/evolution";

import { CARDANO_ASSET_REGEX, CARDANO_UTXO_REF_REGEX } from "./constants";
import type { CardanoUtxoOutput, DecodedCardanoTransaction, ExactCardanoPayload } from "./types";

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
 * Encodes a Cardano payment payload as a JSON object suitable for the x402
 * `payload` field. Matches the spec's PAYMENT-SIGNATURE schema.
 *
 * @param payload - The payload to serialize.
 * @returns A plain object representation of the payload.
 */
export function encodeCardanoPayload(payload: ExactCardanoPayload): Record<string, unknown> {
  return { transaction: payload.transaction, nonce: payload.nonce };
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
 * Returns true when the supplied output pays at least `amount` of `asset` to
 * `recipient`.
 *
 * @param output - The decoded UTXO output.
 * @param recipient - The expected bech32 recipient address.
 * @param asset - Asset unit (`policyId.assetNameHex`).
 * @param amount - Required amount in the asset's smallest unit.
 * @returns True when the output satisfies the requirement.
 */
export function outputSatisfies(
  output: CardanoUtxoOutput,
  recipient: string,
  asset: string,
  amount: bigint,
): boolean {
  if (output.address !== recipient) {
    return false;
  }
  if (asset.toLowerCase() === "lovelace") {
    return output.coin >= amount;
  }
  const assetAmount = output.assets[asset.toLowerCase()] ?? 0n;
  return assetAmount >= amount;
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
  const txHash = TransactionHash.toHex(TransactionBody.toHashFromBytes(bodyBytes));

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
    return { address, coin: out.assets.lovelace, assets };
  });

  const ws = tx.witnessSet;
  const vkeyWitnessCount = (ws.vkeyWitnesses?.length ?? 0) + (ws.bootstrapWitnesses?.length ?? 0);
  const scriptWitnessCount =
    (ws.nativeScripts?.length ?? 0) +
    (ws.plutusV1Scripts?.length ?? 0) +
    (ws.plutusV2Scripts?.length ?? 0) +
    (ws.plutusV3Scripts?.length ?? 0) +
    (ws.redeemers ? ws.redeemers.size : 0);

  return {
    txHash,
    networkId: tx.body.networkId,
    ttlSlot: tx.body.ttl,
    validityStartSlot: tx.body.validityIntervalStart,
    inputs,
    outputs,
    vkeyWitnessCount,
    scriptWitnessCount,
  };
}
