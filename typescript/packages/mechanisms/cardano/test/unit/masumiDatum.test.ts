import { describe, expect, it } from "vitest";
import { Data } from "@evolution-sdk/evolution";
import {
  addressCredentials,
  buildMasumiLockDatum,
  MASUMI_STATE_FUNDS_LOCKED,
  parseMasumiLockDatum,
  type MasumiLockDatumInput,
} from "../../src/exact/masumi/datum";
import { masumiContractAddress } from "../../src/exact/masumi/constants";
import { buildMasumiLockInline, type MasumiBuyerInput } from "../../src/exact/masumi/lock";
import { CARDANO_PREPROD_CAIP2 } from "../../src/constants";
import type { CardanoExtraMasumi } from "../../src/types";

// Base (payment + stake) preprod addresses.
const BUYER =
  "addr_test1qp7573my7h0fyj9cd2fwrws5v6ep0e6urpx007pz0pjnmakny46m3vmfawqwv3m48dv2s6eysht6tjfdk48lrzrkmj5qpmyq7l";
const SELLER =
  "addr_test1qzdjjcstngx8yneqv4d2phmz35ytkyxk4aa09rfexu7kj3evleltf708u3qyrn29sudutxqqy0vx5f3lv73dtewsdras79zz7d";

const input: MasumiLockDatumInput = {
  buyerAddress: BUYER,
  sellerAddress: SELLER,
  referenceKey: "aabb".padEnd(64, "0"),
  referenceSignature: "cc".repeat(32),
  sellerNonce: "11".repeat(32),
  buyerNonce: "22".repeat(32),
  agentIdentifier: "33".repeat(16),
  collateralReturnLovelace: 0n,
  inputHash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  payByTime: 1_000n,
  submitResultTime: 2_000n,
  unlockTime: 3_000n,
  externalDisputeUnlockTime: 4_000n,
};

describe("masumi lock datum codec", () => {
  it("round-trips build -> CBOR -> parse", () => {
    const view = parseMasumiLockDatum(Data.toCBORHex(buildMasumiLockDatum(input)));
    expect(view).not.toBeNull();
    const v = view!;
    expect(v.buyer.payment.hash).toBe(addressCredentials(BUYER).payment.hash);
    expect(v.buyer.stake?.hash).toBe(addressCredentials(BUYER).stake?.hash);
    expect(v.seller.payment.hash).toBe(addressCredentials(SELLER).payment.hash);
    expect(v.seller.stake?.hash).toBe(addressCredentials(SELLER).stake?.hash);
    expect(v.referenceKey).toBe(input.referenceKey);
    expect(v.referenceSignature).toBe(input.referenceSignature);
    expect(v.sellerNonce).toBe(input.sellerNonce);
    expect(v.buyerNonce).toBe(input.buyerNonce);
    expect(v.agentIdentifier).toBe(input.agentIdentifier);
    expect(v.collateralReturnLovelace).toBe(0n);
    expect(v.inputHash).toBe(input.inputHash);
    expect(v.resultHash).toBe(""); // empty at lock
    expect(v.payByTime).toBe(1_000n);
    expect(v.submitResultTime).toBe(2_000n);
    expect(v.unlockTime).toBe(3_000n);
    expect(v.externalDisputeUnlockTime).toBe(4_000n);
    expect(v.sellerCooldownTime).toBe(0n);
    expect(v.buyerCooldownTime).toBe(0n);
    expect(v.state).toBe(MASUMI_STATE_FUNDS_LOCKED);
  });

  it("parses directly from Plutus data too", () => {
    expect(parseMasumiLockDatum(buildMasumiLockDatum(input))?.state).toBe(0n);
  });

  it("encodes optional return addresses (None when absent)", () => {
    const withReturns = buildMasumiLockDatum({ ...input, buyerReturnAddress: BUYER });
    // Structurally valid + still parses; the return address is not surfaced in the view.
    expect(parseMasumiLockDatum(withReturns)).not.toBeNull();
  });

  it("extracts credentials: base has stake, enterprise script address has none", () => {
    expect(addressCredentials(BUYER).stake).toBeDefined();
    const escrow = addressCredentials(masumiContractAddress(CARDANO_PREPROD_CAIP2));
    expect(escrow.payment.isScript).toBe(true);
    expect(escrow.stake).toBeUndefined();
  });

  it("returns null for a non-matching datum", () => {
    expect(parseMasumiLockDatum(Data.constr(0n, [Data.int(1n)]))).toBeNull();
    expect(parseMasumiLockDatum("not-cbor")).toBeNull();
  });
});

// The 402 answers an unauthenticated request, so a server cannot know the
// buyer's nonce, input hash or refund address. The client must be able to build
// a valid lock from a 402 that declares only the seller-side fields.
describe("masumi lock from a server 402 without buyer-side fields", () => {
  const sellerExtra: CardanoExtraMasumi = {
    assetTransferMethod: "masumi",
    contractAddress: masumiContractAddress(CARDANO_PREPROD_CAIP2),
    sellerAddress: SELLER,
    referenceKey: "aabb".padEnd(64, "0"),
    referenceSignature: "cc".repeat(32),
    sellerNonce: "11".repeat(32),
    agentIdentifier: "33".repeat(16),
    payByTime: "1000",
    submitResultTime: "2000",
    unlockTime: "3000",
    externalDisputeUnlockTime: "4000",
  };

  const viewOf = (extra: CardanoExtraMasumi, buyerInput?: MasumiBuyerInput) =>
    parseMasumiLockDatum(Data.toCBORHex(buildMasumiLockInline(extra, BUYER, buyerInput).data))!;

  it("builds without buyer fields, generating a fresh nonce and contract defaults", () => {
    const view = viewOf(sellerExtra);
    expect(view).not.toBeNull();
    // Masumi validates identifierFromPurchaser as a 14-26 character hex string
    // (createPurchaseInitSchemaInput), so the generated nonce must land inside
    // that range — a longer one is rejected off-chain.
    expect(view.buyerNonce).toMatch(/^[0-9a-f]+$/);
    expect(view.buyerNonce.length).toBeGreaterThanOrEqual(14);
    expect(view.buyerNonce.length).toBeLessThanOrEqual(26);
    expect(view.inputHash).toBe("");
    expect(view.buyerReturnAddress).toBeNull();
  });

  it("generates a distinct nonce per lock", () => {
    expect(viewOf(sellerExtra).buyerNonce).not.toBe(viewOf(sellerExtra).buyerNonce);
  });

  it("uses the buyer's supplied purchase values when the client provides them", () => {
    const view = viewOf(sellerExtra, {
      identifierFromPurchaser: "dd".repeat(32),
      inputHash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      buyerReturnAddress: BUYER,
    });
    expect(view.buyerNonce).toBe("dd".repeat(32));
    expect(view.inputHash).toBe("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
    expect(addressCredentials(BUYER).payment.hash).toBe(view.buyerReturnAddress?.payment.hash);
  });

  it("still requires the seller-side fields the server must declare", () => {
    const missingSellerNonce = { ...sellerExtra, sellerNonce: undefined };
    expect(() => buildMasumiLockInline(missingSellerNonce as CardanoExtraMasumi, BUYER)).toThrow(
      /sellerNonce/,
    );
  });
});
