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

type BuildooorModule = typeof import("@harmoniclabs/buildooor");

/**
 * Lazily resolves the optional Buildooor transaction library
 * (`@harmoniclabs/buildooor`). Throws a clear error when the dependency is
 * not installed so the package can ship without forcing it on consumers that
 * only need types/constants.
 *
 * Buildooor is pure TypeScript, so loading it does not incur a WASM
 * initialization step (unlike the previous `@emurgo/cardano-serialization-lib-nodejs`
 * peer dep, which pulled in a ~4 MB WASM blob).
 *
 * @returns The Buildooor module.
 */
async function loadBuildooor(): Promise<BuildooorModule> {
  try {
    return (await import("@harmoniclabs/buildooor")) as BuildooorModule;
  } catch (cause) {
    const error = new Error(
      `${ERR_CARDANO_SDK_MISSING}: install '@harmoniclabs/buildooor' to enable Cardano transaction verification`,
    );
    (error as { cause?: unknown }).cause = cause;
    throw error;
  }
}

/**
 * Decodes a base64-encoded signed Cardano transaction into a structural
 * summary using `@harmoniclabs/buildooor`. Only the fields required by the
 * facilitator are surfaced.
 *
 * @param transactionBase64 - The base64-encoded CBOR transaction.
 * @returns The decoded transaction summary.
 */
export async function decodeCardanoTransaction(
  transactionBase64: string,
): Promise<DecodedCardanoTransaction> {
  const { Tx } = await loadBuildooor();
  const txHex = Buffer.from(transactionBase64, "base64").toString("hex");
  const tx = Tx.fromCbor(txHex);
  const body = tx.body;

  const txHash = tx.hash.toString();

  const inputs = body.inputs.map(u => `${u.utxoRef.id.toString()}#${u.utxoRef.index}`);

  const outputs: CardanoUtxoOutput[] = body.outputs.map(out => {
    const assets: Record<string, bigint> = {};
    // Buildooor's Value is iterable over { policy, assets } entries. The
    // policy field is already a hex string; the lovelace entry uses an
    // empty-policy marker and is read out via `.lovelaces` below instead.
    for (const { policy, assets: list } of out.value) {
      const policyHex = policy.toLowerCase();
      if (policyHex === "") continue;
      for (const { name, quantity } of list) {
        const nameHex = Buffer.from(name).toString("hex").toLowerCase();
        assets[`${policyHex}.${nameHex}`] = quantity;
      }
    }
    return {
      address: out.address.toString(),
      coin: out.value.lovelaces,
      assets,
    };
  });

  const ws = tx.witnesses;
  const sz = (a: readonly unknown[] | undefined): number => a?.length ?? 0;
  const vkeyWitnessCount = sz(ws.vkeyWitnesses) + sz(ws.bootstrapWitnesses);
  const scriptWitnessCount =
    sz(ws.nativeScripts) +
    sz(ws.plutusV1Scripts) +
    sz(ws.plutusV2Scripts) +
    sz(ws.plutusV3Scripts) +
    sz(ws.redeemers);

  return {
    txHash,
    networkId: body.network === "mainnet" ? 1 : body.network === "testnet" ? 0 : undefined,
    ttlSlot: body.ttl,
    validityStartSlot: body.validityIntervalStart,
    inputs,
    outputs,
    vkeyWitnessCount,
    scriptWitnessCount,
  };
}
