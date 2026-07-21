import { describe, expect, it } from "vitest";
import { Data } from "@evolution-sdk/evolution";
import type { PaymentRequirements } from "@x402/core/types";

import { buildMasumiLockDatum, type MasumiLockDatumInput } from "../../src/exact/masumi/datum";
import {
  masumiContractAddress,
  masumiMinUtxoLovelace,
  masumiTokenLockLovelace,
} from "../../src/exact/masumi/constants";
import { verifyMasumiLock } from "../../src/exact/masumi/verify";
import { CARDANO_PREPROD_CAIP2, USDM_PREPROD_ASSET } from "../../src/constants";
import type { CardanoExtraMasumi, DecodedCardanoTransaction } from "../../src/types";

const NETWORK = CARDANO_PREPROD_CAIP2;
const CONTRACT = masumiContractAddress(NETWORK);
const BUYER =
  "addr_test1qp7573my7h0fyj9cd2fwrws5v6ep0e6urpx007pz0pjnmakny46m3vmfawqwv3m48dv2s6eysht6tjfdk48lrzrkmj5qpmyq7l";
const SELLER =
  "addr_test1qzdjjcstngx8yneqv4d2phmz35ytkyxk4aa09rfexu7kj3evleltf708u3qyrn29sudutxqqy0vx5f3lv73dtewsdras79zz7d";

// pay_by_time well in the future; a valid tx TTL is a preprod slot at/before it.
const PAY_BY_TIME = 1_900_000_000_000n;
const VALID_TTL_SLOT = 244_000_000n; // slotToPosixMs ~ 1_899_683_200_000 <= PAY_BY_TIME
const PAST_TTL_SLOT = 245_000_000n; // slotToPosixMs ~ 1_900_683_200_000 > PAY_BY_TIME

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
  payByTime: PAY_BY_TIME,
  submitResultTime: PAY_BY_TIME + 100_000n,
  unlockTime: PAY_BY_TIME + 200_000n,
  externalDisputeUnlockTime: PAY_BY_TIME + 300_000n,
};

const datumHex = (overrides: Partial<MasumiLockDatumInput> = {}): string =>
  Data.toCBORHex(buildMasumiLockDatum({ ...baseDatum, ...overrides }));

/**
 * Rebuilds a lock datum with one `Constr` field replaced, for invariants the
 * builder can't express (a fresh lock always writes empty result_hash / zero
 * cooldowns).
 *
 * @param datum - The source datum CBOR hex.
 * @param index - The datum field index to replace.
 * @param value - The replacement Plutus data.
 * @returns The mutated datum CBOR hex.
 */
const withField = (datum: string, index: number, value: Data.Data): string => {
  const fields = [...(Data.fromCBORHex(datum) as unknown as { fields: Data.Data[] }).fields];
  fields[index] = value;
  return Data.toCBORHex(Data.constr(0n, fields));
};

type DecodeOpts = {
  coin?: bigint;
  assets?: Record<string, bigint>;
  ttlSlot?: bigint;
  noTtl?: boolean;
  hasReferenceScript?: boolean;
};

const decoded = (datum: string | undefined, opts: DecodeOpts = {}): DecodedCardanoTransaction =>
  ({
    txHash: "ab",
    networkId: 0,
    ttlSlot: opts.noTtl ? undefined : (opts.ttlSlot ?? VALID_TTL_SLOT),
    inputs: [],
    outputs: [
      {
        address: CONTRACT,
        coin: opts.coin ?? 5_000_000n,
        assets: opts.assets ?? {},
        datum,
        hasReferenceScript: opts.hasReferenceScript ?? false,
      },
    ],
    vkeyWitnessCount: 1,
    scriptWitnessCount: 0,
    signaturesValid: true,
  }) as DecodedCardanoTransaction;

const requirements = (
  extra: Partial<CardanoExtraMasumi> = {},
  over: Partial<PaymentRequirements> = {},
): PaymentRequirements => ({
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
  ...over,
});

const run = (opts: {
  extra?: Partial<CardanoExtraMasumi>;
  over?: Partial<PaymentRequirements>;
  datum?: string;
  payer?: string;
  payTo?: string;
  decode?: DecodeOpts;
  coinsPerUtxoByte?: bigint;
}) => {
  const req = requirements(opts.extra, opts.over);
  if (opts.payTo) req.payTo = opts.payTo;
  return verifyMasumiLock(
    req.extra as CardanoExtraMasumi,
    req,
    decoded(opts.datum ?? datumHex(), opts.decode),
    opts.payer ?? BUYER,
    opts.coinsPerUtxoByte,
  );
};

describe("verifyMasumiLock", () => {
  it("accepts a valid FundsLocked lock into the escrow", () => {
    expect(run({})).toEqual({ ok: true });
  });

  it("accepts and clears the post-result min-UTXO when coinsPerUtxoByte is supplied", () => {
    expect(run({ coinsPerUtxoByte: 4310n })).toEqual({ ok: true });
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

  it("rejects when the escrow output carries a reference script", () => {
    expect(run({ decode: { hasReferenceScript: true } }).ok).toBe(false);
  });

  it("rejects when the tx has no validity upper bound (TTL)", () => {
    expect(run({ decode: { noTtl: true } }).ok).toBe(false);
  });

  it("rejects when the tx could settle past pay_by_time", () => {
    expect(run({ decode: { ttlSlot: PAST_TTL_SLOT } }).ok).toBe(false);
  });

  it("rejects a non-zero cooldown timer on a fresh lock", () => {
    expect(run({ datum: withField(datumHex(), 16, Data.int(5n)) }).ok).toBe(false);
    expect(run({ datum: withField(datumHex(), 17, Data.int(5n)) }).ok).toBe(false);
  });

  it("rejects a non-empty result_hash on a fresh lock", () => {
    expect(run({ datum: withField(datumHex(), 11, Data.bytearray("aa".repeat(32))) }).ok).toBe(
      false,
    );
  });

  it("rejects collateral above the locked lovelace", () => {
    expect(run({ datum: datumHex({ collateralReturnLovelace: 5_000_001n }) }).ok).toBe(false);
  });

  it("rejects positive collateral below the floor", () => {
    expect(run({ datum: datumHex({ collateralReturnLovelace: 100n }) }).ok).toBe(false);
  });

  it("accepts collateral at the floor within the locked lovelace", () => {
    expect(
      run({
        datum: datumHex({ collateralReturnLovelace: 1_435_230n }),
        over: { amount: "3000000" }, // coin 5M >= 3M amount + 1.435M collateral
        extra: { collateralReturnLovelace: "1435230" },
      }),
    ).toEqual({ ok: true });
  });

  it("rejects when locked lovelace < amount + collateral", () => {
    expect(
      run({
        datum: datumHex({ collateralReturnLovelace: 1_435_230n }),
        over: { amount: "4000000" }, // 5M < 4M + 1.435M
        extra: { collateralReturnLovelace: "1435230" },
      }).ok,
    ).toBe(false);
  });

  it("rejects when the output lovelace is below the post-result min-UTXO", () => {
    expect(
      run({ over: { amount: "1000000" }, decode: { coin: 1_000_000n }, coinsPerUtxoByte: 4310n })
        .ok,
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

  it("rejects out-of-order time bounds", () => {
    expect(run({ datum: datumHex({ payByTime: PAY_BY_TIME + 500_000n }) }).ok).toBe(false);
  });

  it("rejects a server-declared field that does not match the datum", () => {
    expect(run({ extra: { payByTime: "1234" } }).ok).toBe(false);
  });

  it("accepts when the server declares fields that DO match the datum", () => {
    expect(
      run({
        extra: {
          referenceKey: "aa".repeat(32),
          agentIdentifier: "ee".repeat(16),
          payByTime: PAY_BY_TIME.toString(),
        },
      }),
    ).toEqual({ ok: true });
  });

  // Native-token (USDM) locks: the token amount MUST match exactly, while the
  // escrow output's lovelace is structural (covers collateral + min-UTXO).
  const usdm = (over: Partial<PaymentRequirements>, decode: DecodeOpts, cpb?: bigint) =>
    run({ over: { asset: USDM_PREPROD_ASSET, ...over }, decode, coinsPerUtxoByte: cpb });

  it("accepts a USDM lock whose token amount matches exactly", () => {
    expect(
      usdm(
        { amount: "1500000" },
        { assets: { [USDM_PREPROD_ASSET]: 1_500_000n }, coin: 2_000_000n },
      ),
    ).toEqual({ ok: true });
  });

  it("rejects a USDM lock that overpays the token amount", () => {
    expect(
      usdm(
        { amount: "1500000" },
        { assets: { [USDM_PREPROD_ASSET]: 1_500_001n }, coin: 2_000_000n },
      ).ok,
    ).toBe(false);
  });

  it("rejects a USDM lock missing the requested token", () => {
    expect(usdm({ amount: "1500000" }, { assets: {}, coin: 2_000_000n }).ok).toBe(false);
  });

  it("rejects a USDM lock whose structural lovelace is below the post-result min-UTXO", () => {
    expect(
      usdm(
        { amount: "1500000" },
        { assets: { [USDM_PREPROD_ASSET]: 1_500_000n }, coin: 1_000_000n },
        4310n,
      ).ok,
    ).toBe(false);
  });

  it("rejects a lovelace lock carrying extra native tokens (token-count mismatch)", () => {
    expect(run({ decode: { assets: { [USDM_PREPROD_ASSET]: 1n } } }).ok).toBe(false);
  });

  it("rejects a USDM lock carrying an extra unrequested token", () => {
    expect(
      usdm(
        { amount: "1500000" },
        {
          assets: { [USDM_PREPROD_ASSET]: 1_500_000n, [`${"ab".repeat(28)}.beef`]: 1n },
          coin: 2_000_000n,
        },
      ).ok,
    ).toBe(false);
  });

  // seller_return_address (datum field 3) is server-declared, so it must match
  // the declared extra exactly in both directions.
  it("accepts when a declared seller return address matches the datum", () => {
    expect(
      run({
        extra: { sellerReturnAddress: SELLER },
        datum: datumHex({ sellerReturnAddress: SELLER }),
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a datum seller return address the server did not declare", () => {
    expect(run({ datum: datumHex({ sellerReturnAddress: SELLER }) }).ok).toBe(false);
  });

  it("rejects when the server declares a seller return address the datum omits", () => {
    expect(run({ extra: { sellerReturnAddress: SELLER } }).ok).toBe(false);
  });

  it("rejects when a declared seller return address differs from the datum", () => {
    expect(
      run({
        extra: { sellerReturnAddress: SELLER },
        datum: datumHex({ sellerReturnAddress: BUYER }),
      }).ok,
    ).toBe(false);
  });

  // buyer_return_address (datum field 1) is buyer-supplied: the 402 answers an
  // unauthenticated request, so the server cannot know the payer's refund
  // address and normally omits it.
  it("accepts a buyer return address the server did not declare", () => {
    expect(run({ datum: datumHex({ buyerReturnAddress: BUYER }) })).toEqual({ ok: true });
  });

  it("accepts an omitted buyer return address", () => {
    expect(run({})).toEqual({ ok: true });
  });

  // The buyer picks its own refund address, so the facilitator does not match it
  // even when a server declares one — it has no authoritative value to compare
  // against. The buyer stays pinned by the `buyer` = payer rule instead.
  it("does not match the buyer return address against extra", () => {
    expect(
      run({
        extra: { buyerReturnAddress: BUYER },
        datum: datumHex({ buyerReturnAddress: BUYER }),
      }),
    ).toEqual({ ok: true });
    expect(
      run({
        extra: { buyerReturnAddress: BUYER },
        datum: datumHex({ buyerReturnAddress: SELLER }),
      }),
    ).toEqual({ ok: true });
  });
});

// A native-token lock's lovelace is purely structural: the client signer funds it
// itself as max(post-result min-UTXO, collateral) rather than from the requested
// amount. These pin that rule to the floor the facilitator derives independently
// from the decoded datum — if the two ever diverge, a correctly built lock is
// rejected, or an underfunded one is accepted and strands the seller's payout.
describe("masumi native-token structural lovelace", () => {
  const COINS_PER_UTXO_BYTE = 4310n;
  const TOKEN_AMOUNT = 1_500_000n;

  /** The funding the client signer attaches, via the same helper it calls. */
  const clientFunding = (datum: string, collateral: bigint): bigint =>
    masumiTokenLockLovelace(datum.length / 2, collateral, COINS_PER_UTXO_BYTE);

  const lock = (datum: string, coin: bigint, extra: Partial<CardanoExtraMasumi> = {}) =>
    run({
      extra,
      over: { asset: USDM_PREPROD_ASSET, amount: TOKEN_AMOUNT.toString() },
      datum,
      decode: { coin, assets: { [USDM_PREPROD_ASSET]: TOKEN_AMOUNT } },
      coinsPerUtxoByte: COINS_PER_UTXO_BYTE,
    });

  it("funds enough lovelace to clear the facilitator's post-result min-UTXO", () => {
    const datum = datumHex();
    expect(lock(datum, clientFunding(datum, 0n))).toEqual({ ok: true });
  });

  it("funds no more than needed — one lovelace less is rejected", () => {
    const datum = datumHex();
    expect(lock(datum, clientFunding(datum, 0n) - 1n).ok).toBe(false);
  });

  it("raises the funding to the collateral when it exceeds the min-UTXO", () => {
    const collateral = 6_000_000n;
    const extra = { collateralReturnLovelace: collateral.toString() };
    const datum = datumHex({ collateralReturnLovelace: collateral });
    const floor = masumiMinUtxoLovelace(datum.length / 2, 1, COINS_PER_UTXO_BYTE);

    // Guards the fixture: the collateral must actually dominate for this to test
    // the max(), not just the min-UTXO branch again.
    expect(collateral).toBeGreaterThan(floor);

    expect(lock(datum, clientFunding(datum, collateral), extra)).toEqual({ ok: true });
    // Funding the bare min-UTXO and ignoring the collateral bricks the payout.
    expect(lock(datum, floor, extra).ok).toBe(false);
  });
});
