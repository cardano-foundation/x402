import { describe, expect, it } from "vitest";
import {
  decodeCardanoPayload,
  encodeCardanoPayload,
  outputSatisfies,
  parseAssetUnit,
  parseUtxoRef,
} from "../../src/utils";

const ASSET = "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad.0014df105553444d";
const TX_HASH = "a".repeat(64);

describe("Cardano Utils", () => {
  it("parses asset units", () => {
    expect(parseAssetUnit(ASSET)).toEqual({
      policyId: "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad",
      assetNameHex: "0014df105553444d",
    });
    expect(() => parseAssetUnit("not-an-asset")).toThrow();
  });

  it("parses UTXO refs", () => {
    expect(parseUtxoRef(`${TX_HASH}#3`)).toEqual({ txHash: TX_HASH, index: 3 });
    expect(() => parseUtxoRef(`${TX_HASH}#-1`)).toThrow();
  });

  it("encodes and decodes payloads round-trip", () => {
    const encoded = encodeCardanoPayload({ transaction: "tx", nonce: `${TX_HASH}#0` });
    const decoded = decodeCardanoPayload(encoded);
    expect(decoded).toEqual({ transaction: "tx", nonce: `${TX_HASH}#0` });
    expect(() => decodeCardanoPayload({})).toThrow();
    expect(() => decodeCardanoPayload({ transaction: "tx" })).toThrow();
  });

  it("decides output satisfaction by recipient + asset + amount", () => {
    const output = {
      address: "addr1payee",
      coin: 0n,
      assets: { [ASSET.toLowerCase()]: 12_000n },
    };
    expect(outputSatisfies(output, "addr1payee", ASSET, 10_000n)).toBe(true);
    expect(outputSatisfies(output, "addr1payee", ASSET, 13_000n)).toBe(false);
    expect(outputSatisfies(output, "addr1other", ASSET, 1n)).toBe(false);
    expect(outputSatisfies(output, "addr1payee", "deadbeef" + ".".repeat(0), 1n)).toBe(false);
  });

  it("special-cases lovelace against output.coin", () => {
    const output = { address: "addr1payee", coin: 5_000_000n, assets: {} };
    expect(outputSatisfies(output, "addr1payee", "lovelace", 5_000_000n)).toBe(true);
    expect(outputSatisfies(output, "addr1payee", "lovelace", 5_000_001n)).toBe(false);
    expect(parseAssetUnit("lovelace")).toEqual({ policyId: "", assetNameHex: "" });
  });
});
