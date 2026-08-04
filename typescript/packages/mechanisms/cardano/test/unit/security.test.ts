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
import {
  CARDANO_MAINNET_CAIP2,
  CARDANO_MAINNET_CIP34,
  USDM_MAINNET_ASSET,
} from "../../src/constants";
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
  getTransactionEvidence: async () => ({ status: "unknown", confirmations: -2 }),
};

describe("Cardano facilitator security", () => {
  const decodedPayment = () => ({
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
    vkeyHashes: [],
    isValid: true,
    vkeyWitnessCount: 1,
    scriptWitnessCount: 0,
    redeemerCount: 0,
    signaturesValid: true,
  });

  it("reads assetTransferMethod from canonical requirements, not client-echoed accepted", async () => {
    let capturedExtra: Record<string, unknown> | undefined;

    class CaptureFacilitator extends ExactCardanoFacilitator {
      protected override async runMethodSpecificChecks(
        requirements: PaymentRequirements,
      ): Promise<{ ok: true } | { ok: false; reason: string }> {
        capturedExtra = requirements.extra ? { ...requirements.extra } : undefined;
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
      vkeyHashes: [],
      isValid: true,
      vkeyWitnessCount: 1,
      scriptWitnessCount: 0,
      redeemerCount: 0,
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

  it("treats a CIP-34 alias network as equal to its canonical id", async () => {
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
      vkeyHashes: [],
      isValid: true,
      vkeyWitnessCount: 1,
      scriptWitnessCount: 0,
      redeemerCount: 0,
      signaturesValid: true,
    });

    const facilitator = new ExactCardanoFacilitator(stubSigner);
    // Client echoes the CIP-34 form; the server requires the canonical id. The
    // facilitator must normalize both and treat them as the same network.
    const payload = {
      x402Version: 2,
      accepted: { ...buildRequirements(), network: CARDANO_MAINNET_CIP34 },
      payload: { transaction: "AAAA", nonce: `${TX_HASH}#0` },
    };
    const result = await facilitator.verify(payload, buildRequirements());
    expect(result.isValid).toBe(true);
    expect(result.payer).toBe("addr1qpayer00");
  });

  it("rejects Masumi settlement fields on the default method", async () => {
    vi.mocked(decodeCardanoTransaction).mockReturnValueOnce(decodedPayment());
    const requirements = buildRequirements();
    const result = await new ExactCardanoFacilitator(stubSigner).verify(
      {
        x402Version: 2,
        accepted: requirements,
        payload: { transaction: "AAAA", nonce: `${TX_HASH}#0`, settlementLayer: "l1" },
      },
      requirements,
    );
    expect(result.invalidReason).toBe("invalid_exact_cardano_payload_settlement_layer_mismatch");
  });

  it("rejects a confirmation depth it cannot authenticate", async () => {
    vi.mocked(decodeCardanoTransaction).mockReturnValueOnce(decodedPayment());
    const withoutEvidence = { ...stubSigner, getTransactionEvidence: undefined };
    const requirements = buildRequirements();
    const result = await new ExactCardanoFacilitator(withoutEvidence).verify(
      {
        x402Version: 2,
        accepted: requirements,
        payload: { transaction: "AAAA", nonce: `${TX_HASH}#0` },
      },
      requirements,
    );
    expect(result.invalidReason).toBe("exact_cardano_facilitator_evidence_unavailable");
  });

  // `is_valid` sits outside the transaction body, so it is not covered by the
  // transaction id: a client can broadcast the failing (`is_valid = false`) form
  // and hand the facilitator the identical payload claiming `true`. Evidence
  // keyed by that id would then point at a transaction that created no outputs.
  // Only a Plutus-script transaction can be phase-2 invalid at all.
  it("refuses a client-submitted payment that runs Plutus scripts", async () => {
    const decoded = {
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
      vkeyHashes: [],
      isValid: true,
      vkeyWitnessCount: 1,
      scriptWitnessCount: 1,
      redeemerCount: 1,
      signaturesValid: true,
    };
    const clientReqs = buildRequirements({ submissionPolicy: "client" });
    const evidenceSigner: FacilitatorCardanoSigner = {
      ...stubSigner,
      // Even a provider that vouches for the transaction cannot rescue it.
      getTransactionEvidence: async () => ({ status: "confirmed", confirmations: 5 }),
    };
    const payload = {
      x402Version: 2,
      accepted: clientReqs,
      payload: { transaction: "AAAA", nonce: `${TX_HASH}#0`, submissionMode: "client" },
    };

    vi.mocked(decodeCardanoTransaction).mockReturnValueOnce(decoded);
    const refused = await new ExactCardanoFacilitator(evidenceSigner).verify(payload, clientReqs);
    expect(refused.isValid).toBe(false);
    expect(refused.invalidReason).toBe("invalid_exact_cardano_payload_phase2_invalid");

    // The same payment without redeemers is fine.
    vi.mocked(decodeCardanoTransaction).mockReturnValueOnce({
      ...decoded,
      scriptWitnessCount: 0,
      redeemerCount: 0,
    });
    const allowed = await new ExactCardanoFacilitator(evidenceSigner).verify(payload, clientReqs);
    expect(allowed.isValid).toBe(true);

    // An operator with a provider that verifies `valid_contract` can opt in.
    vi.mocked(decodeCardanoTransaction).mockReturnValueOnce(decoded);
    const optedIn = await new ExactCardanoFacilitator(evidenceSigner, {
      allowClientScriptExecution: true,
    }).verify(payload, clientReqs);
    expect(optedIn.isValid).toBe(true);
  });
});
