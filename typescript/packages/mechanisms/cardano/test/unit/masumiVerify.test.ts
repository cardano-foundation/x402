import { describe, expect, it } from "vitest";
import { Data } from "@evolution-sdk/evolution";
import type { PaymentRequirements } from "@x402/core/types";

import { buildMasumiLockDatum, type MasumiLockDatumInput } from "../../src/exact/masumi/datum";
import { masumiContractAddress } from "../../src/exact/masumi/constants";
import { verifyMasumiLock } from "../../src/exact/masumi/verify";
import { CARDANO_PREPROD_CAIP2 } from "../../src/constants";
import type { CardanoExtraMasumi, DecodedCardanoTransaction } from "../../src/types";

const NETWORK = CARDANO_PREPROD_CAIP2;
const CONTRACT = masumiContractAddress(NETWORK);
const BUYER =
  "addr_test1qp7573my7h0fyj9cd2fwrws5v6ep0e6urpx007pz0pjnmakny46m3vmfawqwv3m48dv2s6eysht6tjfdk48lrzrkmj5qpmyq7l";
const SELLER =
  "addr_test1qzdjjcstngx8yneqv4d2phmz35ytkyxk4aa09rfexu7kj3evleltf708u3qyrn29sudutxqqy0vx5f3lv73dtewsdras79zz7d";

const baseDatum: MasumiLockDatumInput = {
  buyerAddress: BUYER,
  sellerAddress: SELLER,
  referenceKey: "aa".repeat(32),
  referenceSignature: "bb".repeat(32),
  sellerNonce: "cc".repeat(32),
  buyerNonce: "dd".repeat(32),
  agentIdentifier: "ee".repeat(16),
  collateralReturnLovelace: 0n,
  inputHash: "",
  payByTime: 1_000n,
  submitResultTime: 2_000n,
  unlockTime: 3_000n,
  externalDisputeUnlockTime: 4_000n,
};

const datumHex = (overrides: Partial<MasumiLockDatumInput> = {}): string =>
  Data.toCBORHex(buildMasumiLockDatum({ ...baseDatum, ...overrides }));

const decoded = (datum: string | undefined, coin = 5_000_000n): DecodedCardanoTransaction =>
  ({
    txHash: "ab",
    networkId: 0,
    inputs: [],
    outputs: [{ address: CONTRACT, coin, assets: {}, datum }],
    vkeyWitnessCount: 1,
    scriptWitnessCount: 0,
    signaturesValid: true,
  }) as DecodedCardanoTransaction;

const requirements = (extra: Partial<CardanoExtraMasumi> = {}): PaymentRequirements => ({
  scheme: "exact",
  network: NETWORK,
  asset: "lovelace",
  amount: "5000000",
  payTo: CONTRACT,
  maxTimeoutSeconds: 600,
  extra: {
    assetTransferMethod: "masumi",
    contractAddress: CONTRACT,
    sellerAddress: SELLER,
    ...extra,
  },
});

const run = (opts: {
  extra?: Partial<CardanoExtraMasumi>;
  datum?: string;
  payer?: string;
  payTo?: string;
}) => {
  const req = requirements(opts.extra);
  if (opts.payTo) req.payTo = opts.payTo;
  return verifyMasumiLock(
    req.extra as CardanoExtraMasumi,
    req,
    decoded(opts.datum ?? datumHex()),
    opts.payer ?? BUYER,
  );
};

describe("verifyMasumiLock", () => {
  it("accepts a valid FundsLocked lock into the escrow", () => {
    expect(run({})).toEqual({ ok: true });
  });

  it("rejects when payTo is not the declared escrow address", () => {
    expect(run({ payTo: SELLER }).ok).toBe(false);
  });

  it("rejects when contractAddress is absent (not defaulted)", () => {
    expect(run({ extra: { contractAddress: undefined } }).ok).toBe(false);
  });

  it("rejects when the escrow output has no inline datum", () => {
    const req = requirements();
    expect(
      verifyMasumiLock(req.extra as CardanoExtraMasumi, req, decoded(undefined), BUYER).ok,
    ).toBe(false);
  });

  it("rejects when the datum buyer is not the payer", () => {
    expect(run({ payer: SELLER }).ok).toBe(false);
  });

  it("rejects when the datum seller is not the declared seller", () => {
    expect(run({ datum: datumHex({ sellerAddress: BUYER }) }).ok).toBe(false);
  });

  it("rejects a reference_signature shorter than 16 bytes", () => {
    expect(run({ datum: datumHex({ referenceSignature: "aa" }) }).ok).toBe(false);
  });

  it("rejects a non-empty result_hash / wrong state is impossible at build, so check ordering", () => {
    expect(run({ datum: datumHex({ payByTime: 9_000n }) }).ok).toBe(false);
  });

  it("rejects a server-declared field that does not match the datum", () => {
    expect(run({ extra: { payByTime: "1234" }, datum: datumHex({ payByTime: 5_678n }) }).ok).toBe(
      false,
    );
  });

  it("accepts when the server declares fields that DO match the datum", () => {
    expect(
      run({
        extra: {
          referenceKey: "aa".repeat(32),
          agentIdentifier: "ee".repeat(16),
          payByTime: "1000",
        },
      }),
    ).toEqual({ ok: true });
  });
});
