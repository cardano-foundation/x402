import { describe, expect, it } from "vitest";
import { ExactCardanoScheme as ExactCardanoClient } from "../../src/exact/client/scheme";
import {
  ExactCardanoScheme as ExactCardanoFacilitator,
  supportedCardanoNetworks,
} from "../../src/exact/facilitator/scheme";
import { ExactCardanoScheme as ExactCardanoServer } from "../../src/exact/server/scheme";
import {
  CARDANO_MAINNET_CAIP2,
  CARDANO_NETWORKS,
  CARDANO_PREPROD_CAIP2,
  USDM_MAINNET_ASSET,
} from "../../src/constants";
import type { ClientCardanoSigner, FacilitatorCardanoSigner } from "../../src/signer";
import type { PaymentRequirements } from "@x402/core/types";

const TX_HASH = "a".repeat(64);

const RECIPIENT = "addr1qxytestrecipientaddress00";

const buildRequirements = (overrides: Partial<PaymentRequirements> = {}): PaymentRequirements => ({
  scheme: "exact",
  network: CARDANO_MAINNET_CAIP2,
  asset: USDM_MAINNET_ASSET,
  amount: "10000",
  payTo: RECIPIENT,
  maxTimeoutSeconds: 600,
  extra: {},
  ...overrides,
});

const stubSigner: ClientCardanoSigner = {
  getAddress: () => "addr1qxsomeaddress00",
  signPaymentTransaction: () => ({
    transaction: "AAAA",
    nonce: `${TX_HASH}#0`,
  }),
};

const stubFacilitatorSigner: FacilitatorCardanoSigner = {
  getAddresses: () => ["addr1qfacilitator00"],
  getUtxo: async () => ({ exists: true, address: "addr1qpayer00" }),
  getCurrentSlot: async () => 100n,
  submitTransaction: async () => ({ txHash: "deadbeef", status: "confirmed" }),
};

describe("ExactCardanoScheme client", () => {
  const client = new ExactCardanoClient(stubSigner);

  it("declares the 'exact' scheme", () => {
    expect(client.scheme).toBe("exact");
  });

  it("rejects non-Cardano networks", async () => {
    const reqs = buildRequirements({ network: "ethereum:1" });
    await expect(client.createPaymentPayload(2, reqs)).rejects.toThrow(
      /Unsupported Cardano network/,
    );
  });

  it("rejects invalid pay-to addresses", async () => {
    await expect(
      client.createPaymentPayload(2, buildRequirements({ payTo: "0xnope" })),
    ).rejects.toThrow(/Invalid Cardano pay-to address/);
  });

  it("rejects invalid asset units", async () => {
    await expect(
      client.createPaymentPayload(2, buildRequirements({ asset: "not.a.unit" })),
    ).rejects.toThrow(/Invalid Cardano asset unit/);
  });

  it("rejects non-numeric amounts", async () => {
    await expect(
      client.createPaymentPayload(2, buildRequirements({ amount: "10.5" })),
    ).rejects.toThrow(/Amount must be a non-negative integer/);
  });

  it("returns a payload from the signer for valid requirements", async () => {
    const result = await client.createPaymentPayload(2, buildRequirements());
    expect(result.x402Version).toBe(2);
    expect(result.payload).toEqual({
      transaction: "AAAA",
      nonce: `${TX_HASH}#0`,
    });
  });

  it("rejects signer responses with invalid nonce", async () => {
    const badSigner: ClientCardanoSigner = {
      getAddress: () => "addr1q",
      signPaymentTransaction: () => ({ transaction: "AA", nonce: "bad" }),
    };
    const c = new ExactCardanoClient(badSigner);
    await expect(c.createPaymentPayload(2, buildRequirements())).rejects.toThrow(
      /Cardano signer returned an invalid nonce/,
    );
  });
});

describe("ExactCardanoScheme facilitator", () => {
  it("declares CAIP family and scheme identifier", () => {
    const facilitator = new ExactCardanoFacilitator(stubFacilitatorSigner);
    expect(facilitator.scheme).toBe("exact");
    expect(facilitator.caipFamily).toBe("cardano:*");
  });

  it("returns its addresses via getSigners", () => {
    const facilitator = new ExactCardanoFacilitator(stubFacilitatorSigner);
    expect(facilitator.getSigners(CARDANO_MAINNET_CAIP2)).toEqual(["addr1qfacilitator00"]);
  });

  it("returns undefined for getExtra (no metadata required by default)", () => {
    const facilitator = new ExactCardanoFacilitator(stubFacilitatorSigner);
    expect(facilitator.getExtra(CARDANO_PREPROD_CAIP2)).toBeUndefined();
  });

  it("rejects payloads when networks differ", async () => {
    const facilitator = new ExactCardanoFacilitator(stubFacilitatorSigner);
    const result = await facilitator.verify(
      {
        x402Version: 2,
        accepted: buildRequirements({ network: "cardano:preview" }),
        payload: { transaction: "AA", nonce: `${TX_HASH}#0` },
      },
      buildRequirements(),
    );
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("network_mismatch");
  });

  it("rejects payloads with non-Cardano networks", async () => {
    const facilitator = new ExactCardanoFacilitator(stubFacilitatorSigner);
    const reqs = buildRequirements({ network: "ethereum:1" });
    const result = await facilitator.verify(
      { x402Version: 2, accepted: reqs, payload: { transaction: "AA", nonce: `${TX_HASH}#0` } },
      reqs,
    );
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("network_mismatch");
  });

  it("rejects payloads with malformed nonce", async () => {
    const facilitator = new ExactCardanoFacilitator(stubFacilitatorSigner);
    const reqs = buildRequirements();
    const result = await facilitator.verify(
      { x402Version: 2, accepted: reqs, payload: { transaction: "AA", nonce: "bad" } },
      reqs,
    );
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("invalid_exact_cardano_payload_nonce_invalid");
  });

  it("rejects payloads missing transaction", async () => {
    const facilitator = new ExactCardanoFacilitator(stubFacilitatorSigner);
    const reqs = buildRequirements();
    const result = await facilitator.verify(
      { x402Version: 2, accepted: reqs, payload: { nonce: `${TX_HASH}#0` } },
      reqs,
    );
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("invalid_exact_cardano_payload");
  });

  it("exposes the supported networks", () => {
    expect(supportedCardanoNetworks()).toEqual(CARDANO_NETWORKS);
  });

  it("rejects script assetTransferMethod by default to avoid silent acceptance", async () => {
    // The base implementation cannot reconstruct script addresses; integrators
    // must override `runMethodSpecificChecks`. Until then, script payments are
    // refused even when the funds and address match.
    class TestFacilitator extends ExactCardanoFacilitator {}
    const facilitator = new TestFacilitator(stubFacilitatorSigner);
    // We cannot easily exercise the full happy path without a CSL build, but
    // we can confirm the method rejects by reaching into the protected hook.
    const result = await (
      facilitator as unknown as {
        runMethodSpecificChecks: (
          extra: Record<string, unknown> | undefined,
          payTo: string,
          payer: string,
        ) => Promise<{ ok: true } | { ok: false; reason: string }>;
      }
    ).runMethodSpecificChecks(
      {
        assetTransferMethod: "script",
        scriptHash: "deadbeef",
      },
      RECIPIENT,
      "addr1qpayer00",
    );
    expect(result).toEqual({
      ok: false,
      reason: "invalid_exact_cardano_payload_script_address_mismatch",
    });
  });

  it("rejects a second concurrent settle as duplicate", async () => {
    class FakeOk extends ExactCardanoFacilitator {
      override async verify() {
        return { isValid: true, payer: "addr1qpayer00" };
      }
    }
    const facilitator = new FakeOk(stubFacilitatorSigner);
    const reqs = buildRequirements();
    const payload = {
      x402Version: 2,
      accepted: reqs,
      payload: { transaction: "AAAA", nonce: `${TX_HASH}#0` },
    };
    const first = await facilitator.settle(payload, reqs);
    const second = await facilitator.settle(payload, reqs);
    expect(first.success).toBe(true);
    expect(second.success).toBe(false);
    expect(second.errorReason).toBe("duplicate_settlement");
  });

  it("rejects mempool-only settlements when acceptMempool is disabled (default)", async () => {
    const mempoolSigner: FacilitatorCardanoSigner = {
      ...stubFacilitatorSigner,
      submitTransaction: async () => ({ txHash: "abc", status: "mempool" }),
    };
    // Bypass verify() by stubbing it via subclass for this isolation test.
    class FakeOk extends ExactCardanoFacilitator {
      override async verify() {
        return { isValid: true, payer: "addr1qpayer00" };
      }
    }
    const facilitator = new FakeOk(mempoolSigner);
    const reqs = buildRequirements();
    const settle = await facilitator.settle(
      {
        x402Version: 2,
        accepted: reqs,
        payload: { transaction: "AAAA", nonce: `${TX_HASH}#0` },
      },
      reqs,
    );
    expect(settle.success).toBe(false);
    expect(settle.errorReason).toBe("exact_cardano_settlement_not_confirmed");
    expect(settle.transaction).toBe("abc");
  });

  it("accepts mempool-only settlements when acceptMempool is true", async () => {
    const mempoolSigner: FacilitatorCardanoSigner = {
      ...stubFacilitatorSigner,
      submitTransaction: async () => ({ txHash: "abc", status: "mempool" }),
    };
    class FakeOk extends ExactCardanoFacilitator {
      override async verify() {
        return { isValid: true, payer: "addr1qpayer00" };
      }
    }
    const facilitator = new FakeOk(mempoolSigner, { acceptMempool: true });
    const reqs = buildRequirements();
    const settle = await facilitator.settle(
      {
        x402Version: 2,
        accepted: reqs,
        payload: { transaction: "AAAA", nonce: `${TX_HASH}#0` },
      },
      reqs,
    );
    expect(settle.success).toBe(true);
    expect((settle.extensions as { status?: string } | undefined)?.status).toBe("mempool");
  });
});

describe("ExactCardanoScheme server", () => {
  it("parses Money strings to USDM atomic units", async () => {
    const server = new ExactCardanoServer();
    const result = await server.parsePrice("$1.50", CARDANO_MAINNET_CAIP2);
    expect(result.amount).toBe("1500000");
    expect(result.asset).toBe(USDM_MAINNET_ASSET);
  });

  it("passes through AssetAmount", async () => {
    const server = new ExactCardanoServer();
    const result = await server.parsePrice(
      { amount: "12345", asset: USDM_MAINNET_ASSET, extra: { tier: "premium" } },
      CARDANO_MAINNET_CAIP2,
    );
    expect(result.amount).toBe("12345");
    expect(result.extra?.tier).toBe("premium");
  });

  it("supports MoneyParser chaining", async () => {
    const server = new ExactCardanoServer();
    server.registerMoneyParser(async amount =>
      amount > 100
        ? { amount: (amount * 1e6).toString(), asset: USDM_MAINNET_ASSET, extra: { tier: "vip" } }
        : null,
    );
    const big = await server.parsePrice("150", CARDANO_MAINNET_CAIP2);
    expect(big.extra?.tier).toBe("vip");
    const small = await server.parsePrice("1", CARDANO_MAINNET_CAIP2);
    expect(small.extra?.tier).toBeUndefined();
    expect(small.amount).toBe("1000000");
  });

  it("enhancePaymentRequirements merges supported kind extra", async () => {
    const server = new ExactCardanoServer();
    const baseRequirements = buildRequirements({ extra: { foo: "bar" } });
    const enhanced = await server.enhancePaymentRequirements(
      baseRequirements,
      {
        x402Version: 2,
        scheme: "exact",
        network: CARDANO_MAINNET_CAIP2,
        extra: { policy: "default" },
      },
      [],
    );
    expect(enhanced.extra).toEqual({ policy: "default", foo: "bar" });
  });
});
