import { Transaction } from "@evolution-sdk/evolution";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { x402Client } from "@x402/core/client";
import { x402Facilitator } from "@x402/core/facilitator";
import { x402ResourceServer, FacilitatorClient } from "@x402/core/server";
import {
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
  SupportedResponse,
} from "@x402/core/types";

import { ExactCardanoScheme as ExactCardanoClient } from "../../src/exact/client/scheme";
import { ExactCardanoScheme as ExactCardanoFacilitator } from "../../src/exact/facilitator/scheme";
import { ExactCardanoScheme as ExactCardanoServer } from "../../src/exact/server/scheme";
import { toClientCardanoSigner, toFacilitatorCardanoSigner } from "../../src/signer";
import { LOVELACE_ASSET, USDM_PREPROD_ASSET } from "../../src/constants";
import { masumiContractAddress } from "../../src/exact/masumi/constants";
import { buildMasumiLockDatum, inlineDatum } from "../../src/exact/masumi/datum";
import { decodeCardanoTransaction } from "../../src/utils";
import { buildSignedTx } from "../helpers/buildSignedTx";
import {
  buildRequirements,
  freshPreprodAddress,
  MINIMAL_PLUTUS_V3,
  NETWORK,
  NONCE_REF,
  PAYER_ADDRESS,
  scriptAddressFor,
  stubClientSigner,
  stubFacilitatorSigner,
  TTL_SLOT,
} from "../helpers/stubs";

/**
 * Wraps the x402Facilitator for use with x402ResourceServer.
 */
class CardanoFacilitatorClient implements FacilitatorClient {
  readonly scheme = "exact";
  readonly network = NETWORK;
  readonly x402Version = 2;

  /**
   * @param facilitator - The x402 facilitator to wrap.
   */
  constructor(private readonly facilitator: x402Facilitator) {}

  /**
   * @param paymentPayload - The payment payload to verify.
   * @param paymentRequirements - The payment requirements.
   * @returns The verification response.
   */
  verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    return this.facilitator.verify(paymentPayload, paymentRequirements);
  }

  /**
   * @param paymentPayload - The payment payload to settle.
   * @param paymentRequirements - The payment requirements.
   * @returns The settlement response.
   */
  settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    return this.facilitator.settle(paymentPayload, paymentRequirements);
  }

  /**
   * @returns The supported payment kinds.
   */
  getSupported(): Promise<SupportedResponse> {
    return Promise.resolve(this.facilitator.getSupported());
  }
}

describe("Cardano Integration Tests (deterministic, offline)", () => {
  let recipient: string;

  beforeAll(async () => {
    recipient = await freshPreprodAddress();
  });

  describe("x402Client / x402ResourceServer / x402Facilitator - full flow", () => {
    let client: x402Client;
    let server: x402ResourceServer;

    beforeEach(async () => {
      client = new x402Client().register(NETWORK, new ExactCardanoClient(stubClientSigner()));

      const facilitator = new x402Facilitator().register(
        NETWORK,
        new ExactCardanoFacilitator(stubFacilitatorSigner()),
      );
      server = new x402ResourceServer(new CardanoFacilitatorClient(facilitator));
      server.register(NETWORK, new ExactCardanoServer());
      await server.initialize();
    });

    it("verifies and settles a lovelace payment end to end", async () => {
      const accepts = [buildRequirements(recipient, "1000000")];
      const resource = {
        url: "https://company.co",
        description: "Company Co. resource",
        mimeType: "application/json",
      };
      const paymentRequired = await server.createPaymentRequiredResponse(accepts, resource);

      const paymentPayload = await client.createPaymentPayload(paymentRequired);
      expect(paymentPayload.x402Version).toBe(2);
      expect(paymentPayload.accepted.scheme).toBe("exact");
      expect(
        (paymentPayload.payload as { transaction: string }).transaction.length,
      ).toBeGreaterThan(0);
      expect((paymentPayload.payload as { nonce: string }).nonce).toBe(NONCE_REF);

      const accepted = server.findMatchingRequirements(accepts, paymentPayload);
      expect(accepted).toBeDefined();

      const verifyResponse = await server.verifyPayment(paymentPayload, accepted!);
      expect(verifyResponse.isValid).toBe(true);
      expect(verifyResponse.payer).toBe(PAYER_ADDRESS);

      const settleResponse = await server.settlePayment(paymentPayload, accepted!);
      expect(settleResponse.success).toBe(true);
      expect(settleResponse.network).toBe(NETWORK);
      expect(settleResponse.transaction).toBe("f".repeat(64));
    });

    it("verifies and settles a native USDM payment end to end", async () => {
      const accepts = [buildRequirements(recipient, "1500000", USDM_PREPROD_ASSET)];
      const paymentRequired = await server.createPaymentRequiredResponse(accepts, {
        url: "https://company.co",
        description: "Company Co. resource",
        mimeType: "application/json",
      });

      const paymentPayload = await client.createPaymentPayload(paymentRequired);
      const accepted = server.findMatchingRequirements(accepts, paymentPayload);
      const verifyResponse = await server.verifyPayment(paymentPayload, accepted!);
      expect(verifyResponse.isValid).toBe(true);

      const settleResponse = await server.settlePayment(paymentPayload, accepted!);
      expect(settleResponse.success).toBe(true);
    });
  });

  describe("facilitator verify() rules against real signed transactions", () => {
    /**
     * Builds an x402 payload from a freshly built fixture transaction.
     *
     * @param payTo - The address the transaction output pays.
     * @param amount - The lovelace amount the output carries.
     * @param requirements - The requirements to verify the payload against.
     * @returns The payload and requirements pair.
     */
    async function fixturePayload(
      payTo: string,
      amount: bigint,
      datum?: ReturnType<typeof inlineDatum>,
    ): Promise<PaymentPayload> {
      const built = await buildSignedTx({
        payTo,
        asset: LOVELACE_ASSET,
        amount,
        nonceUtxoRef: NONCE_REF,
        ttlSlot: TTL_SLOT,
        network: NETWORK,
        ...(datum ? { datum } : {}),
      });
      return {
        x402Version: 2,
        accepted: buildRequirements(payTo, amount.toString()),
        payload: { transaction: built.transaction, nonce: built.nonce },
      };
    }

    it("accepts a transaction that satisfies every rule", async () => {
      const facilitator = new ExactCardanoFacilitator(stubFacilitatorSigner());
      const payload = await fixturePayload(recipient, 1_000_000n);
      const result = await facilitator.verify(payload, buildRequirements(recipient, "1000000"));
      expect(result.isValid).toBe(true);
      expect(result.payer).toBe(PAYER_ADDRESS);
    });

    it("rejects when the output pays a different recipient (rule 3)", async () => {
      const facilitator = new ExactCardanoFacilitator(stubFacilitatorSigner());
      const other = await freshPreprodAddress();
      const payload = await fixturePayload(recipient, 1_000_000n);
      const result = await facilitator.verify(payload, buildRequirements(other, "1000000"));
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("invalid_exact_cardano_payload_recipient_mismatch");
    });

    it("rejects when the output amount is insufficient (rule 4)", async () => {
      const facilitator = new ExactCardanoFacilitator(stubFacilitatorSigner());
      const payload = await fixturePayload(recipient, 500_000n);
      const result = await facilitator.verify(payload, buildRequirements(recipient, "1000000"));
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("invalid_exact_cardano_payload_amount_insufficient");
    });

    it("rejects when the output is below the protocol min-UTXO", async () => {
      // An absurdly large coinsPerUtxoByte pushes the min-UTXO far above the
      // output's 1 ADA, exercising the min-UTXO comparison branch.
      const facilitator = new ExactCardanoFacilitator(
        stubFacilitatorSigner({ getCoinsPerUtxoByte: async () => 100_000n }),
      );
      const payload = await fixturePayload(recipient, 1_000_000n);
      const result = await facilitator.verify(payload, buildRequirements(recipient, "1000000"));
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("invalid_exact_cardano_payload_min_utxo_insufficient");
    });

    it("accepts an output that meets the protocol min-UTXO", async () => {
      const facilitator = new ExactCardanoFacilitator(
        stubFacilitatorSigner({ getCoinsPerUtxoByte: async () => 4310n }),
      );
      const payload = await fixturePayload(recipient, 2_000_000n);
      const result = await facilitator.verify(payload, buildRequirements(recipient, "2000000"));
      expect(result.isValid).toBe(true);
    });

    it("rejects when the nonce UTXO is already spent (rule 5)", async () => {
      const facilitator = new ExactCardanoFacilitator(
        stubFacilitatorSigner({ getUtxo: async () => ({ exists: false }) }),
      );
      const payload = await fixturePayload(recipient, 1_000_000n);
      const result = await facilitator.verify(payload, buildRequirements(recipient, "1000000"));
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("invalid_exact_cardano_payload_nonce_not_on_chain");
    });

    it("rejects when the transaction TTL has expired (rule 6)", async () => {
      const facilitator = new ExactCardanoFacilitator(
        stubFacilitatorSigner({ getCurrentSlot: async () => TTL_SLOT + 1n }),
      );
      const payload = await fixturePayload(recipient, 1_000_000n);
      const result = await facilitator.verify(payload, buildRequirements(recipient, "1000000"));
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("invalid_exact_cardano_payload_ttl_expired");
    });

    it("accepts a script payment to the reconstructed script address", async () => {
      const facilitator = new ExactCardanoFacilitator(stubFacilitatorSigner());
      const { address: scriptAddr } = scriptAddressFor(MINIMAL_PLUTUS_V3);
      const payload = await fixturePayload(scriptAddr, 2_000_000n);
      const requirements = buildRequirements(scriptAddr, "2000000", LOVELACE_ASSET, {
        assetTransferMethod: "script",
        script: { type: "plutusV3", code: MINIMAL_PLUTUS_V3 },
      });
      const result = await facilitator.verify(payload, requirements);
      expect(result.isValid).toBe(true);
    });

    it("rejects a script payment whose payTo is not the declared script", async () => {
      const facilitator = new ExactCardanoFacilitator(stubFacilitatorSigner());
      const payload = await fixturePayload(recipient, 2_000_000n);
      const requirements = buildRequirements(recipient, "2000000", LOVELACE_ASSET, {
        assetTransferMethod: "script",
        script: { type: "plutusV3", code: MINIMAL_PLUTUS_V3 },
      });
      const result = await facilitator.verify(payload, requirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("invalid_exact_cardano_payload_script_address_mismatch");
    });

    it("accepts a masumi lock into the escrow with a valid FundsLocked datum", async () => {
      // The datum buyer must equal the payer the facilitator resolves from the
      // nonce input, so return a real (parseable) buyer address from getUtxo.
      const buyer = await freshPreprodAddress();
      const facilitator = new ExactCardanoFacilitator(
        stubFacilitatorSigner({ getUtxo: async () => ({ exists: true, address: buyer }) }),
      );
      const escrow = masumiContractAddress(NETWORK);
      const datum = inlineDatum(
        buildMasumiLockDatum({
          buyerAddress: buyer,
          sellerAddress: recipient,
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
        }),
      );
      const payload = await fixturePayload(escrow, 5_000_000n, datum);
      const requirements = buildRequirements(escrow, "5000000", LOVELACE_ASSET, {
        assetTransferMethod: "masumi",
        contractAddress: escrow,
        sellerAddress: recipient,
      });
      const result = await facilitator.verify(payload, requirements);
      expect(result.isValid).toBe(true);
    });

    it("rejects a masumi payment whose payTo is not the declared escrow address", async () => {
      const facilitator = new ExactCardanoFacilitator(stubFacilitatorSigner());
      const payload = await fixturePayload(recipient, 5_000_000n);
      const requirements = buildRequirements(recipient, "5000000", LOVELACE_ASSET, {
        assetTransferMethod: "masumi",
        contractAddress: masumiContractAddress(NETWORK),
        sellerAddress: recipient,
      });
      const result = await facilitator.verify(payload, requirements);
      expect(result.isValid).toBe(false);
    });

    it("accepts a multi-input tx when every input is unspent, rejects when one is spent", async () => {
      const secondRef = `${"b".repeat(64)}#0`;
      // Small nonce funding + a second wallet UTXO forces coin selection to add
      // a second input, so the transaction has more than just the nonce input.
      const built = await buildSignedTx({
        payTo: recipient,
        asset: LOVELACE_ASSET,
        amount: 2_000_000n,
        nonceUtxoRef: NONCE_REF,
        ttlSlot: TTL_SLOT,
        network: NETWORK,
        fundingLovelace: 1_000_000n,
        secondInput: { ref: secondRef, lovelace: 5_000_000n },
      });
      expect(decodeCardanoTransaction(built.transaction).inputs).toHaveLength(2);

      const payload: PaymentPayload = {
        x402Version: 2,
        accepted: buildRequirements(recipient, "2000000"),
        payload: { transaction: built.transaction, nonce: built.nonce },
      };
      const requirements = buildRequirements(recipient, "2000000");

      // All inputs unspent → valid.
      const ok = await new ExactCardanoFacilitator(stubFacilitatorSigner()).verify(
        payload,
        requirements,
      );
      expect(ok.isValid).toBe(true);

      // The coin-selected (non-nonce) input is already spent → rejected.
      const spent = await new ExactCardanoFacilitator(
        stubFacilitatorSigner({
          getUtxo: async ref => ({ exists: !ref.startsWith("bbbb"), address: PAYER_ADDRESS }),
        }),
      ).verify(payload, requirements);
      expect(spent.isValid).toBe(false);
      expect(spent.invalidReason).toBe("invalid_exact_cardano_payload_input_not_available");
    });

    it("rejects a transaction whose vkey signature does not match the body", async () => {
      // Graft a second transaction's witness onto the first's body: the grafted
      // signature was produced over a different body hash, so it is invalid.
      const valid = await buildSignedTx({
        payTo: recipient,
        asset: LOVELACE_ASSET,
        amount: 1_000_000n,
        nonceUtxoRef: NONCE_REF,
        ttlSlot: TTL_SLOT,
        network: NETWORK,
      });
      const otherTx = await buildSignedTx({
        payTo: await freshPreprodAddress(),
        asset: LOVELACE_ASSET,
        amount: 1_500_000n,
        nonceUtxoRef: `${"c".repeat(64)}#0`,
        ttlSlot: TTL_SLOT,
        network: NETWORK,
      });
      const base64ToTx = (b64: string) =>
        Transaction.fromCBORBytes(Uint8Array.from(Buffer.from(b64, "base64")));
      const tampered = new Transaction.Transaction({
        body: base64ToTx(valid.transaction).body,
        witnessSet: base64ToTx(otherTx.transaction).witnessSet,
        isValid: true,
        auxiliaryData: null,
      });
      const tamperedTransaction = Buffer.from(Transaction.toCBORBytes(tampered)).toString("base64");

      const facilitator = new ExactCardanoFacilitator(stubFacilitatorSigner());
      const result = await facilitator.verify(
        {
          x402Version: 2,
          accepted: buildRequirements(recipient, "1000000"),
          payload: { transaction: tamperedTransaction, nonce: NONCE_REF },
        },
        buildRequirements(recipient, "1000000"),
      );
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("invalid_exact_cardano_payload_invalid_signature");
    });
  });

  describe("Price parsing", () => {
    let server: x402ResourceServer;
    let cardanoServer: ExactCardanoServer;

    beforeEach(async () => {
      const facilitator = new x402Facilitator().register(
        NETWORK,
        new ExactCardanoFacilitator(stubFacilitatorSigner()),
      );
      server = new x402ResourceServer(new CardanoFacilitatorClient(facilitator));
      cardanoServer = new ExactCardanoServer();
      server.register(NETWORK, cardanoServer);
      await server.initialize();
    });

    it("parses Money formats to USDM atomic units (6 decimals)", async () => {
      const cases = [
        { input: "$1.00", expected: "1000000" },
        { input: "1.50", expected: "1500000" },
        { input: 2.5, expected: "2500000" },
      ];
      for (const { input, expected } of cases) {
        const requirements = await server.buildPaymentRequirements({
          scheme: "exact",
          payTo: recipient,
          price: input,
          network: NETWORK,
        });
        expect(requirements).toHaveLength(1);
        expect(requirements[0].amount).toBe(expected);
        expect(requirements[0].asset).toBe(USDM_PREPROD_ASSET);
      }
    });

    it("passes AssetAmount through unchanged", async () => {
      const requirements = await server.buildPaymentRequirements({
        scheme: "exact",
        payTo: recipient,
        price: { amount: "12345", asset: USDM_PREPROD_ASSET, extra: { tier: "premium" } },
        network: NETWORK,
      });
      expect(requirements[0].amount).toBe("12345");
      expect(requirements[0].extra?.tier).toBe("premium");
    });

    it("honors a registered custom MoneyParser", async () => {
      cardanoServer.registerMoneyParser(async amount =>
        amount > 100
          ? { amount: (amount * 1e6).toString(), asset: USDM_PREPROD_ASSET, extra: { tier: "vip" } }
          : null,
      );
      const big = await server.buildPaymentRequirements({
        scheme: "exact",
        payTo: recipient,
        price: 150,
        network: NETWORK,
      });
      expect(big[0].extra?.tier).toBe("vip");
      const small = await server.buildPaymentRequirements({
        scheme: "exact",
        payTo: recipient,
        price: 50,
        network: NETWORK,
      });
      expect(small[0].extra?.tier).toBeUndefined();
      expect(small[0].amount).toBe("50000000");
    });
  });
});

// Live preprod settlement. Skipped unless funded test wallets + a Blockfrost
// project id are provided. Mirrors the env-gated style of the other mechanisms
// but skips cleanly so CI without secrets stays green.
const LIVE_ENV = {
  clientMnemonic: process.env.CLIENT_CARDANO_MNEMONIC,
  facilitatorMnemonic: process.env.FACILITATOR_CARDANO_MNEMONIC,
  blockfrostBaseUrl: process.env.BLOCKFROST_PREPROD_URL,
  blockfrostProjectId: process.env.BLOCKFROST_PROJECT_ID,
  payTo: process.env.RESOURCE_SERVER_CARDANO_ADDRESS,
};
const LIVE_READY = Object.values(LIVE_ENV).every(Boolean);

describe.skipIf(!LIVE_READY)("Cardano Integration Tests (live preprod)", () => {
  it("verifies and settles a real payment on preprod", async () => {
    const provider = {
      blockfrost: {
        baseUrl: LIVE_ENV.blockfrostBaseUrl!,
        projectId: LIVE_ENV.blockfrostProjectId!,
      },
    };

    const clientSigner = toClientCardanoSigner({
      mnemonic: LIVE_ENV.clientMnemonic!,
      network: NETWORK,
      provider,
    });
    const facilitatorSigner = toFacilitatorCardanoSigner({
      mnemonic: LIVE_ENV.facilitatorMnemonic!,
      network: NETWORK,
      provider,
      awaitConfirmation: true,
    });

    const client = new x402Client().register(NETWORK, new ExactCardanoClient(clientSigner));
    const facilitator = new x402Facilitator().register(
      NETWORK,
      new ExactCardanoFacilitator(facilitatorSigner),
    );
    const server = new x402ResourceServer(new CardanoFacilitatorClient(facilitator));
    server.register(NETWORK, new ExactCardanoServer());
    await server.initialize();

    const accepts = [buildRequirements(LIVE_ENV.payTo!, "1000000")];
    const paymentRequired = await server.createPaymentRequiredResponse(accepts, {
      url: "https://company.co",
      description: "Company Co. resource",
      mimeType: "application/json",
    });

    const paymentPayload = await client.createPaymentPayload(paymentRequired);
    const accepted = server.findMatchingRequirements(accepts, paymentPayload);
    expect(accepted).toBeDefined();

    const verifyResponse = await server.verifyPayment(paymentPayload, accepted!);
    expect(verifyResponse.isValid).toBe(true);

    const settleResponse = await server.settlePayment(paymentPayload, accepted!);
    expect(settleResponse.success).toBe(true);
    expect(settleResponse.transaction.length).toBeGreaterThan(0);
  });
});
