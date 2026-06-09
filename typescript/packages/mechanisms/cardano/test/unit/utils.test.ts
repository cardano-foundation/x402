import { describe, expect, it } from "vitest";
import { decodeCardanoPayload, parseAssetUnit, parseUtxoRef } from "../../src/utils";

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

  it("decodes payloads and rejects malformed ones", () => {
    const decoded = decodeCardanoPayload({ transaction: "tx", nonce: `${TX_HASH}#0` });
    expect(decoded).toEqual({ transaction: "tx", nonce: `${TX_HASH}#0` });
    expect(() => decodeCardanoPayload({})).toThrow();
    expect(() => decodeCardanoPayload({ transaction: "tx" })).toThrow();
  });

  it("parses the lovelace asset unit", () => {
    expect(parseAssetUnit("lovelace")).toEqual({ policyId: "", assetNameHex: "" });
  });
});
