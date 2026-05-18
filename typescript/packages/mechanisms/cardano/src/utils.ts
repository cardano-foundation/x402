import { CARDANO_ASSET_REGEX, CARDANO_UTXO_REF_REGEX, ERR_CARDANO_SDK_MISSING } from "./constants";
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
 * Lazily resolves the optional Cardano serialization library
 * (`@emurgo/cardano-serialization-lib-nodejs`). Throws a clear error when the
 * dependency is not installed so the package can ship without forcing the
 * heavy WASM bundle on consumers that only need types/constants.
 *
 * @returns The CSL module.
 */
export async function loadCardanoSerializationLib(): Promise<unknown> {
  try {
    return await import("@emurgo/cardano-serialization-lib-nodejs");
  } catch (cause) {
    const error = new Error(
      `${ERR_CARDANO_SDK_MISSING}: install '@emurgo/cardano-serialization-lib-nodejs' to enable Cardano transaction verification`,
    );
    (error as { cause?: unknown }).cause = cause;
    throw error;
  }
}

/**
 * Decodes a base64-encoded signed Cardano transaction into a structural
 * summary using `cardano-serialization-lib`. Only the fields required by the
 * facilitator are surfaced.
 *
 * @param transactionBase64 - The base64-encoded CBOR transaction.
 * @returns The decoded transaction summary.
 */
export async function decodeCardanoTransaction(
  transactionBase64: string,
): Promise<DecodedCardanoTransaction> {
  const csl = (await loadCardanoSerializationLib()) as CslModule;
  const txBytes = Buffer.from(transactionBase64, "base64");
  const tx = csl.Transaction.from_bytes(txBytes);
  const body = tx.body();

  // CSL v13+ removed the top-level `hash_transaction` export. Prefer
  // `FixedTransaction` (available since v11 and still present in v15) and
  // fall back to the legacy call only when running against CSL v11/v12,
  // so the package keeps its declared peer-dep range of `>=11.5.0`.
  const txHashBytes = csl.FixedTransaction
    ? csl.FixedTransaction.new_from_body_bytes(body.to_bytes()).transaction_hash().to_bytes()
    : csl.hash_transaction!(body).to_bytes();
  const txHash = Buffer.from(txHashBytes).toString("hex");

  const networkId = readNetworkId(body);
  const ttlSlot = readTtl(body);
  const validityStartSlot = readValidityStart(body);

  const inputs = readInputs(body);
  const outputs = readOutputs(csl, body);
  const { vkeyWitnessCount, scriptWitnessCount } = readWitnessCounts(tx);

  return {
    txHash,
    networkId,
    ttlSlot,
    validityStartSlot,
    inputs,
    outputs,
    vkeyWitnessCount,
    scriptWitnessCount,
  };
}

interface CslTransactionInput {
  transaction_id(): { to_bytes(): Uint8Array };
  index(): number | bigint;
}

interface CslTransactionInputs {
  len(): number;
  get(index: number): CslTransactionInput;
}

interface CslAddress {
  to_bech32(): string;
}

interface CslAssetName {
  name(): Uint8Array;
}

interface CslBigNum {
  to_str(): string;
}

interface CslAssets {
  len(): number;
  keys(): { len(): number; get(index: number): CslAssetName };
  get(name: CslAssetName): CslBigNum | undefined;
}

interface CslScriptHash {
  to_bytes(): Uint8Array;
}

interface CslMultiAsset {
  len(): number;
  keys(): { len(): number; get(index: number): CslScriptHash };
  get(scriptHash: CslScriptHash): CslAssets | undefined;
}

interface CslValue {
  coin(): CslBigNum;
  multiasset(): CslMultiAsset | undefined;
}

interface CslTransactionOutput {
  address(): CslAddress;
  amount(): CslValue;
}

interface CslTransactionOutputs {
  len(): number;
  get(index: number): CslTransactionOutput;
}

interface CslTransactionBody {
  inputs(): CslTransactionInputs;
  outputs(): CslTransactionOutputs;
  ttl?(): unknown;
  ttl_bignum?(): CslBigNum | undefined;
  validity_start_interval?(): unknown;
  validity_start_interval_bignum?(): CslBigNum | undefined;
  network_id?(): { kind(): number } | undefined;
}

interface CslWitnessGroup {
  len(): number;
}

interface CslTransactionWitnessSet {
  vkeys?(): CslWitnessGroup | undefined;
  bootstraps?(): CslWitnessGroup | undefined;
  native_scripts?(): CslWitnessGroup | undefined;
  plutus_scripts?(): CslWitnessGroup | undefined;
  plutus_v2_scripts?(): CslWitnessGroup | undefined;
  plutus_v3_scripts?(): CslWitnessGroup | undefined;
  redeemers?(): CslWitnessGroup | undefined;
}

interface CslTransaction {
  body(): CslTransactionBody;
  witness_set(): CslTransactionWitnessSet;
}

interface CslModule {
  Transaction: { from_bytes(bytes: Uint8Array): CslTransaction };
  // CSL v11/v12 only.
  hash_transaction?(body: CslTransactionBody): { to_bytes(): Uint8Array };
  // CSL v13+ replacement: stable body hash via FixedTransaction.
  FixedTransaction?: {
    new_from_body_bytes(bytes: Uint8Array): {
      transaction_hash(): { to_bytes(): Uint8Array };
    };
  };
}

/**
 * Counts the verification-relevant witnesses on a Cardano transaction. Used
 * by the facilitator to reject unsigned payments in `verify()`.
 *
 * @param tx - The CSL transaction.
 * @returns Counts of vkey/bootstrap witnesses and of script witnesses.
 */
function readWitnessCounts(tx: CslTransaction): {
  vkeyWitnessCount: number;
  scriptWitnessCount: number;
} {
  let vkeyWitnessCount = 0;
  let scriptWitnessCount = 0;
  const ws = tx.witness_set();
  const sizeOf = (group: CslWitnessGroup | undefined): number =>
    group && typeof group.len === "function" ? group.len() : 0;
  if (typeof ws.vkeys === "function") vkeyWitnessCount += sizeOf(ws.vkeys());
  if (typeof ws.bootstraps === "function") vkeyWitnessCount += sizeOf(ws.bootstraps());
  if (typeof ws.native_scripts === "function") scriptWitnessCount += sizeOf(ws.native_scripts());
  if (typeof ws.plutus_scripts === "function") scriptWitnessCount += sizeOf(ws.plutus_scripts());
  if (typeof ws.plutus_v2_scripts === "function")
    scriptWitnessCount += sizeOf(ws.plutus_v2_scripts());
  if (typeof ws.plutus_v3_scripts === "function")
    scriptWitnessCount += sizeOf(ws.plutus_v3_scripts());
  if (typeof ws.redeemers === "function") scriptWitnessCount += sizeOf(ws.redeemers());
  return { vkeyWitnessCount, scriptWitnessCount };
}

/**
 * Reads the optional network_id field from the transaction body. Returns
 * `undefined` when the body does not declare a network id (older era txs).
 *
 * @param body - The CSL transaction body.
 * @returns The numeric network id or undefined.
 */
function readNetworkId(body: CslTransactionBody): number | undefined {
  if (typeof body.network_id !== "function") {
    return undefined;
  }
  const id = body.network_id();
  if (!id) {
    return undefined;
  }
  return id.kind();
}

/**
 * Reads the TTL slot from the transaction body using whichever accessor the
 * loaded CSL build exposes (`ttl_bignum` on newer builds, `ttl` on older).
 *
 * @param body - The CSL transaction body.
 * @returns The TTL slot or undefined.
 */
function readTtl(body: CslTransactionBody): bigint | undefined {
  if (typeof body.ttl_bignum === "function") {
    const v = body.ttl_bignum();
    if (v) {
      return BigInt(v.to_str());
    }
  }
  if (typeof body.ttl === "function") {
    const v = body.ttl();
    if (v == null) return undefined;
    if (typeof v === "number" || typeof v === "bigint") return BigInt(v);
    if (typeof v === "object" && v !== null && "to_str" in v) {
      return BigInt((v as CslBigNum).to_str());
    }
  }
  return undefined;
}

/**
 * Reads the validity_start_interval (lower bound) from the transaction body.
 *
 * @param body - The CSL transaction body.
 * @returns The validity-start slot or undefined.
 */
function readValidityStart(body: CslTransactionBody): bigint | undefined {
  if (typeof body.validity_start_interval_bignum === "function") {
    const v = body.validity_start_interval_bignum();
    if (v) return BigInt(v.to_str());
  }
  if (typeof body.validity_start_interval === "function") {
    const v = body.validity_start_interval();
    if (v == null) return undefined;
    if (typeof v === "number" || typeof v === "bigint") return BigInt(v);
    if (typeof v === "object" && v !== null && "to_str" in v) {
      return BigInt((v as CslBigNum).to_str());
    }
  }
  return undefined;
}

/**
 * Returns the transaction inputs as `txHash#index` strings.
 *
 * @param body - The CSL transaction body.
 * @returns Ordered list of UTXO references.
 */
function readInputs(body: CslTransactionBody): string[] {
  const inputs = body.inputs();
  const result: string[] = [];
  const len = inputs.len();
  for (let i = 0; i < len; i++) {
    const input = inputs.get(i);
    const txId = Buffer.from(input.transaction_id().to_bytes()).toString("hex");
    const idx = Number(input.index());
    result.push(`${txId}#${idx}`);
  }
  return result;
}

/**
 * Decodes the transaction outputs into a SDK-agnostic representation.
 *
 * @param csl - The loaded CSL module.
 * @param body - The CSL transaction body.
 * @returns Ordered decoded outputs.
 */
function readOutputs(csl: CslModule, body: CslTransactionBody): CardanoUtxoOutput[] {
  void csl;
  const outputs = body.outputs();
  const result: CardanoUtxoOutput[] = [];
  const len = outputs.len();
  for (let i = 0; i < len; i++) {
    const out = outputs.get(i);
    const address = out.address().to_bech32();
    const value = out.amount();
    const coin = BigInt(value.coin().to_str());
    const assets: Record<string, bigint> = {};
    const multi = value.multiasset();
    if (multi) {
      const scriptHashes = multi.keys();
      const policyCount = scriptHashes.len();
      for (let p = 0; p < policyCount; p++) {
        const scriptHash = scriptHashes.get(p);
        const policyHex = Buffer.from(scriptHash.to_bytes()).toString("hex").toLowerCase();
        const inner = multi.get(scriptHash);
        if (!inner) continue;
        const names = inner.keys();
        const nameCount = names.len();
        for (let n = 0; n < nameCount; n++) {
          const assetName = names.get(n);
          const nameHex = Buffer.from(assetName.name()).toString("hex").toLowerCase();
          const qty = inner.get(assetName);
          if (!qty) continue;
          assets[`${policyHex}.${nameHex}`] = BigInt(qty.to_str());
        }
      }
    }
    result.push({ address, coin, assets });
  }
  return result;
}
