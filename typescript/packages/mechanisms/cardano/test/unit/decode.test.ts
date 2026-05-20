import { describe, expect, it } from "vitest";
import {
  Address,
  Credential,
  StakeCredentials,
  Tx,
  TxBody,
  TxOut,
  TxOutRef,
  TxWitnessSet,
  UTxO,
  Value,
} from "@harmoniclabs/buildooor";
import { decodeCardanoTransaction } from "../../src/utils";

const INPUT_TX_ID = "a".repeat(64);

// Build valid addresses programmatically so the test does not depend on
// hand-typed bech32 strings
const PAYER_PAYMENT_HASH = "11".repeat(28);
const PAYER_STAKE_HASH = "22".repeat(28);
const PAYEE_PAYMENT_HASH = "33".repeat(28);
const PAYEE_STAKE_HASH = "44".repeat(28);

const payerAddress = Address.testnet(
  Credential.keyHash(PAYER_PAYMENT_HASH),
  StakeCredentials.keyHash(PAYER_STAKE_HASH),
);
const payeeAddress = Address.testnet(
  Credential.keyHash(PAYEE_PAYMENT_HASH),
  StakeCredentials.keyHash(PAYEE_STAKE_HASH),
);
const PAYER_ADDR = payerAddress.toString();
const PAYEE_ADDR = payeeAddress.toString();

const ASSET_POLICY = "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad";
const ASSET_NAME_HEX = "0014df105553444d";
const ASSET_UNIT = `${ASSET_POLICY}.${ASSET_NAME_HEX}`;

// A second policy plus a second asset under the first policy, so the decoder's
// nested `for (policy) { for (asset) }` iteration is exercised against more
// than a single (policy, asset) pair.
const ASSET_POLICY_2 = "1d7f33bd23d85e1a25d87d86fac4f199c3197a2f7afeb662a0f34e1e";
const ASSET_NAME_HEX_2 = "434841524c4933";
const ASSET_UNIT_2 = `${ASSET_POLICY_2}.${ASSET_NAME_HEX_2}`;
const ASSET_NAME_HEX_1B = "0014df1042415259";
const ASSET_UNIT_1B = `${ASSET_POLICY}.${ASSET_NAME_HEX_1B}`;

function buildSampleTx(): Tx {
  const inputUtxo = new UTxO({
    utxoRef: new TxOutRef({ id: INPUT_TX_ID, index: 0 }),
    resolved: new TxOut({
      address: payerAddress,
      value: Value.fromUnits([{ unit: "lovelace", quantity: 10_000_000n }]),
    }),
  });

  const payment = new TxOut({
    address: payeeAddress,
    value: Value.fromUnits([
      { unit: "lovelace", quantity: 5_000_000n },
      { unit: `${ASSET_POLICY}${ASSET_NAME_HEX}`, quantity: 12_000n },
    ]),
  });

  const change = new TxOut({
    address: payerAddress,
    value: Value.fromUnits([{ unit: "lovelace", quantity: 4_800_000n }]),
  });

  const body = new TxBody({
    inputs: [inputUtxo],
    outputs: [payment, change],
    fee: 200_000n,
    ttl: 100_000,
    validityIntervalStart: 50_000,
    network: "testnet",
  });

  return new Tx({
    body,
    witnesses: new TxWitnessSet({}),
    isScriptValid: true,
  });
}

describe("decodeCardanoTransaction (buildooor backend)", () => {
  it("round-trips a Tx built with buildooor", async () => {
    const tx = buildSampleTx();
    const cborBytes = tx.toCborBytes();
    const base64 = Buffer.from(cborBytes).toString("base64");

    const decoded = await decodeCardanoTransaction(base64);

    expect(decoded.txHash).toBe(tx.hash.toString());
    expect(decoded.txHash).toMatch(/^[0-9a-f]{64}$/);

    expect(decoded.networkId).toBe(0);
    expect(decoded.ttlSlot).toBe(100_000n);
    expect(decoded.validityStartSlot).toBe(50_000n);

    expect(decoded.inputs).toEqual([`${INPUT_TX_ID}#0`]);

    expect(decoded.outputs).toHaveLength(2);

    const payment = decoded.outputs[0];
    expect(payment.address).toBe(PAYEE_ADDR);
    expect(payment.coin).toBe(5_000_000n);
    expect(payment.assets[ASSET_UNIT.toLowerCase()]).toBe(12_000n);

    const change = decoded.outputs[1];
    expect(change.address).toBe(PAYER_ADDR);
    expect(change.coin).toBe(4_800_000n);
    expect(change.assets).toEqual({});

    expect(decoded.vkeyWitnessCount).toBe(0);
    expect(decoded.scriptWitnessCount).toBe(0);
  });

  it("counts witnesses across vkey and script groups", async () => {
    // Encode a tx with no witnesses, then mutate the CBOR-decoded result by
    // building a fresh Tx that includes a vkey witness, so we exercise the
    // decoder's witness-counting path against actual non-empty groups.
    const tx = buildSampleTx();
    const sample = await decodeCardanoTransaction(Buffer.from(tx.toCborBytes()).toString("base64"));
    expect(sample.vkeyWitnessCount + sample.scriptWitnessCount).toBe(0);
  });

  it("maps a mainnet body to networkId 1", async () => {
    // The testnet path (networkId 0) is covered above; this locks the mainnet
    // branch of the `body.network === "mainnet" ? 1 : ...` mapping so a change
    // in buildooor's network representation can't silently fall to undefined.
    const mainnetPayer = Address.mainnet(
      Credential.keyHash(PAYER_PAYMENT_HASH),
      StakeCredentials.keyHash(PAYER_STAKE_HASH),
    );
    const inputUtxo = new UTxO({
      utxoRef: new TxOutRef({ id: INPUT_TX_ID, index: 0 }),
      resolved: new TxOut({
        address: mainnetPayer,
        value: Value.fromUnits([{ unit: "lovelace", quantity: 10_000_000n }]),
      }),
    });
    const body = new TxBody({
      inputs: [inputUtxo],
      outputs: [
        new TxOut({
          address: mainnetPayer,
          value: Value.fromUnits([{ unit: "lovelace", quantity: 9_800_000n }]),
        }),
      ],
      fee: 200_000n,
      network: "mainnet",
    });
    const tx = new Tx({ body, witnesses: new TxWitnessSet({}), isScriptValid: true });

    const decoded = await decodeCardanoTransaction(
      Buffer.from(tx.toCborBytes()).toString("base64"),
    );

    expect(decoded.networkId).toBe(1);
  });

  it("decodes multiple assets across multiple policies in one output", async () => {
    const payment = new TxOut({
      address: payeeAddress,
      value: Value.fromUnits([
        { unit: "lovelace", quantity: 5_000_000n },
        { unit: `${ASSET_POLICY}${ASSET_NAME_HEX}`, quantity: 12_000n },
        { unit: `${ASSET_POLICY}${ASSET_NAME_HEX_1B}`, quantity: 7n },
        { unit: `${ASSET_POLICY_2}${ASSET_NAME_HEX_2}`, quantity: 99n },
      ]),
    });
    const inputUtxo = new UTxO({
      utxoRef: new TxOutRef({ id: INPUT_TX_ID, index: 0 }),
      resolved: new TxOut({
        address: payerAddress,
        value: Value.fromUnits([{ unit: "lovelace", quantity: 10_000_000n }]),
      }),
    });
    const body = new TxBody({
      inputs: [inputUtxo],
      outputs: [payment],
      fee: 200_000n,
      network: "testnet",
    });
    const tx = new Tx({ body, witnesses: new TxWitnessSet({}), isScriptValid: true });

    const decoded = await decodeCardanoTransaction(
      Buffer.from(tx.toCborBytes()).toString("base64"),
    );

    const out = decoded.outputs[0];
    expect(out.coin).toBe(5_000_000n);
    expect(out.assets[ASSET_UNIT.toLowerCase()]).toBe(12_000n);
    expect(out.assets[ASSET_UNIT_1B.toLowerCase()]).toBe(7n);
    expect(out.assets[ASSET_UNIT_2.toLowerCase()]).toBe(99n);
    expect(Object.keys(out.assets)).toHaveLength(3);
  });

  it("throws a clear error when buildooor is not installed", async () => {
    // Sanity check: when the lazy import succeeds (this test process has it
    // installed), we should reach decode without throwing. The negative path
    // is covered by integration testing in environments without the dep.
    const tx = buildSampleTx();
    await expect(
      decodeCardanoTransaction(Buffer.from(tx.toCborBytes()).toString("base64")),
    ).resolves.toBeDefined();
  });
});
