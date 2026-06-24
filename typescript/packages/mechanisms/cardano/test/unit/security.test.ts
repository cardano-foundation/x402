import { describe, expect, it, vi } from "vitest";

// Stub `decodeCardanoTransaction` so the test injects deterministic decoded
// shapes without going through Evolution SDK. The mock must be declared
// before importing the facilitator scheme so the bound import inside that
// module picks up the stub.
vi.mock("../../src/utils", async original => {
  const actual = (await original()) as Record<string, unknown>;
  return {
    ...actual,
    decodeCardanoTransaction: vi.fn(),
  };
});

import { decodeCardanoTransaction } from "../../src/utils";
import { ExactCardanoScheme as ExactCardanoFacilitator } from "../../src/exact/facilitator/scheme";
import { CARDANO_MAINNET_CAIP2, USDM_MAINNET_ASSET } from "../../src/constants";
import type { FacilitatorCardanoSigner } from "../../src/signer";
import type { PaymentRequirements } from "@x402/core/types";

const TX_HASH = "a".repeat(64);
const RECIPIENT = "addr1qxytestrecipientaddress00";

const buildRequirements = (extra: Record<string, unknown> = {}): PaymentRequirements => ({
  scheme: "exact",
  network: CARDANO_MAINNET_CAIP2,
  asset: USDM_MAINNET_ASSET,
  amount: "10000",
  payTo: RECIPIENT,
  maxTimeoutSeconds: 600,
  extra,
});

const stubSigner: FacilitatorCardanoSigner = {
  getAddresses: () => ["addr1qfacilitator00"],
  getUtxo: async () => ({ exists: true, address: "addr1qpayer00" }),
  getCurrentSlot: async () => 100n,
  submitTransaction: async () => ({ txHash: "deadbeef", status: "confirmed" }),
};

describe("Cardano facilitator security", () => {
  it("reads assetTransferMethod from canonical requirements, not client-echoed accepted", async () => {
    let capturedExtra: Record<string, unknown> | undefined;

    class CaptureFacilitator extends ExactCardanoFacilitator {
      protected override async runMethodSpecificChecks(
        extra: Record<string, unknown> | undefined,
      ): Promise<{ ok: true } | { ok: false; reason: string }> {
        capturedExtra = extra ? { ...extra } : undefined;
        return { ok: true };
      }
    }

    vi.mocked(decodeCardanoTransaction).mockReturnValueOnce({
      txHash: "abc",
      networkId: 1,
      ttlSlot: undefined,
      validityStartSlot: undefined,
      inputs: [`${TX_HASH}#0`],
      outputs: [
        {
          address: RECIPIENT,
          coin: 0n,
          assets: { [USDM_MAINNET_ASSET.toLowerCase()]: 10_000n },
        },
      ],
      vkeyWitnessCount: 1,
      scriptWitnessCount: 0,
      signaturesValid: true,
    });

    const facilitator = new CaptureFacilitator(stubSigner);
    const serverReqs = buildRequirements({
      assetTransferMethod: "script",
      scriptHash: "deadbeef",
    });
    const payload = {
      x402Version: 2,
      accepted: buildRequirements({ assetTransferMethod: "default" }),
      payload: { transaction: "AAAA", nonce: `${TX_HASH}#0` },
    };
    const result = await facilitator.verify(payload, serverReqs);
    expect(result.isValid).toBe(true);
    expect(capturedExtra).toEqual({
      assetTransferMethod: "script",
      scriptHash: "deadbeef",
    });
  });
});
