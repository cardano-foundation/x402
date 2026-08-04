import { beforeAll, describe, expect, it } from "vitest";
import { ExactCardanoScheme as ExactCardanoClient } from "../../src/exact/client/scheme";
import {
  ExactCardanoScheme as ExactCardanoFacilitatorBase,
  supportedCardanoNetworks,
  type ExactCardanoFacilitatorConfig,
} from "../../src/exact/facilitator/scheme";
import {
  ExactCardanoScheme as ExactCardanoServerBase,
  type ExactCardanoServerConfig,
} from "../../src/exact/server/scheme";
import {
  CARDANO_MAINNET_CAIP2,
  CARDANO_NETWORKS,
  CARDANO_PREPROD_CAIP2,
  LOVELACE_ASSET,
  USDM_MAINNET_ASSET,
} from "../../src/constants";
import type { ClientCardanoSigner, FacilitatorCardanoSigner } from "../../src/signer";
import { decodeCardanoTransaction } from "../../src/utils";
import {
  InMemoryCardanoOperationStore,
  InMemoryCardanoSettlementStore,
} from "../../src/idempotency";
import { validateMasumiExtra } from "../../src/exact/masumi/schema";
import { issueMasumiRequirements } from "../helpers/masumi";
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { buildSignedTx } from "../helpers/buildSignedTx";
import {
  freshPreprodAddress,
  NONCE_REF,
  stubFacilitatorSigner as stubFacilitator,
  TTL_SLOT,
} from "../helpers/stubs";

const PREPROD = CARDANO_PREPROD_CAIP2;

/** Test-only facilitator with explicit volatile replay storage. */
class ExactCardanoFacilitator extends ExactCardanoFacilitatorBase {
  constructor(signer: FacilitatorCardanoSigner, config: ExactCardanoFacilitatorConfig = {}) {
    super(signer, { inMemorySettlementStoreMaxEntries: 4096, ...config });
  }
}

/** Test-only resource server with explicit volatile replay storage. */
class ExactCardanoServer extends ExactCardanoServerBase {
  constructor(config: ExactCardanoServerConfig = {}) {
    super({ inMemoryStore: {}, ...config });
  }
}

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
  buildAndSignPaymentTransaction: () => ({
    transaction: "AAAA",
    nonce: `${TX_HASH}#0`,
  }),
};

async function serverReplayFixture(body: unknown = { job: 1 }) {
  const payTo = await freshPreprodAddress();
  const built = await buildSignedTx({
    payTo,
    asset: LOVELACE_ASSET,
    amount: 2_000_000n,
    nonceUtxoRef: NONCE_REF,
    ttlSlot: TTL_SLOT,
    network: PREPROD,
  });
  const requirements = buildRequirements({
    network: PREPROD,
    payTo,
    asset: LOVELACE_ASSET,
    amount: "2000000",
  });
  const paymentPayload: PaymentPayload = {
    x402Version: 2,
    accepted: requirements,
    payload: { transaction: built.transaction, nonce: built.nonce },
  };
  const transportContext = {
    request: {
      method: "POST",
      adapter: {
        getMethod: () => "POST",
        getUrl: () => "https://example.com/jobs",
        getHeader: (name: string) =>
          name === "content-type"
            ? "application/json"
            : name === "authorization"
              ? "Bearer owner-token"
              : undefined,
        getBody: () => body,
      },
    },
  };
  return {
    context: {
      paymentPayload,
      requirements,
      declaredExtensions: {},
      transportContext,
      result: { isValid: true, payer: "addr_test1payer" },
    },
    transportContext,
  };
}

async function attachReplayChallenge(
  server: ExactCardanoServer,
  fixture: Awaited<ReturnType<typeof serverReplayFixture>>,
  echoPaymentPayload = false,
): Promise<string> {
  const paymentRequiredResponse: PaymentRequired = {
    x402Version: 2,
    resource: { url: "https://example.com/jobs" },
    accepts: [fixture.context.requirements],
  };
  await server.enrichPaymentRequiredResponse({
    requirements: [fixture.context.requirements],
    requirement: fixture.context.requirements,
    resourceInfo: paymentRequiredResponse.resource,
    paymentRequiredResponse,
    transportContext: fixture.transportContext,
    ...(echoPaymentPayload ? { paymentPayload: fixture.context.paymentPayload } : {}),
  });
  fixture.context.paymentPayload.extensions = paymentRequiredResponse.extensions;
  const challenge = (
    paymentRequiredResponse.extensions?.cardanoReplayProtection as {
      challenges?: Record<string, string>;
    }
  )?.challenges;
  const value = challenge && Object.values(challenge)[0];
  if (!value) throw new Error("test replay challenge was not issued");
  return value;
}

const stubFacilitatorSigner: FacilitatorCardanoSigner = {
  getAddresses: () => ["addr1qfacilitator00"],
  getUtxo: async () => ({ exists: true, address: "addr1qpayer00" }),
  validatePhase1Transaction: async () => undefined,
  getCurrentSlot: async () => 100n,
  submitTransaction: async transaction => ({
    txHash: decodeCardanoTransaction(transaction).txHash,
    status: "confirmed",
  }),
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
    ).rejects.toThrow(/canonical lowercase form/);
  });

  it("rejects non-numeric amounts", async () => {
    await expect(
      client.createPaymentPayload(2, buildRequirements({ amount: "10.5" })),
    ).rejects.toThrow(/positive canonical integer/);
  });

  it("rejects zero, leading-zero, and uppercase wire values", async () => {
    await expect(
      client.createPaymentPayload(2, buildRequirements({ amount: "0" })),
    ).rejects.toThrow(/positive canonical integer/);
    await expect(
      client.createPaymentPayload(2, buildRequirements({ amount: "010000" })),
    ).rejects.toThrow(/positive canonical integer/);
    await expect(
      client.createPaymentPayload(
        2,
        buildRequirements({ asset: USDM_MAINNET_ASSET.toUpperCase() }),
      ),
    ).rejects.toThrow(/canonical lowercase form/);
  });

  it("rejects Masumi settlement fields returned for a default payment", async () => {
    const c = new ExactCardanoClient({
      ...stubSigner,
      buildAndSignPaymentTransaction: () => ({
        transaction: "AAAA",
        nonce: `${TX_HASH}#0`,
        settlementLayer: "l1",
      }),
    });
    await expect(c.createPaymentPayload(2, buildRequirements())).rejects.toThrow(
      /non-Masumi payment/,
    );
  });

  it("returns a payload from the signer for valid requirements", async () => {
    const result = await client.createPaymentPayload(2, buildRequirements());
    expect(result.x402Version).toBe(2);
    // An absent `submissionPolicy` normalizes to `server`, and the payload
    // records the mode the signer was asked to honour.
    expect(result.payload).toEqual({
      transaction: "AAAA",
      nonce: `${TX_HASH}#0`,
      submissionMode: "server",
    });
  });

  it("selects the mode the server's submissionPolicy dictates", async () => {
    const seen: string[] = [];
    const recordingSigner: ClientCardanoSigner = {
      getAddress: () => "addr1qxsomeaddress00",
      buildAndSignPaymentTransaction: input => {
        seen.push(input.submissionMode);
        return {
          transaction: "AAAA",
          nonce: `${TX_HASH}#0`,
          submissionMode: input.submissionMode,
        };
      },
    };
    const c = new ExactCardanoClient(recordingSigner);
    await c.createPaymentPayload(2, buildRequirements({ extra: { submissionPolicy: "client" } }));
    expect(seen).toEqual(["client"]);

    // `either` leaves the choice to the client's configured preference.
    const preferring = new ExactCardanoClient(recordingSigner, "client");
    const result = await preferring.createPaymentPayload(
      2,
      buildRequirements({ extra: { submissionPolicy: "either" } }),
    );
    expect((result.payload as { submissionMode: string }).submissionMode).toBe("client");
  });

  it("rejects requirements carrying an invalid policy", async () => {
    await expect(
      client.createPaymentPayload(
        2,
        buildRequirements({ extra: { confirmationPolicy: { l1Confirmations: 99 } } }),
      ),
    ).rejects.toThrow(/invalid submission\/confirmation policy/);
  });

  it("rejects a signer that ignored client-submission mode", async () => {
    const lyingSigner: ClientCardanoSigner = {
      getAddress: () => "addr1qxsomeaddress00",
      buildAndSignPaymentTransaction: () => ({
        transaction: "AAAA",
        nonce: `${TX_HASH}#0`,
        submissionMode: "server" as const,
      }),
    };
    const c = new ExactCardanoClient(lyingSigner);
    await expect(
      c.createPaymentPayload(2, buildRequirements({ extra: { submissionPolicy: "client" } })),
    ).rejects.toThrow(/honoured submissionMode server, expected client/);
  });

  it("rejects a signer that omits client-submission mode", async () => {
    const omittingSigner: ClientCardanoSigner = {
      getAddress: () => "addr1qxsomeaddress00",
      buildAndSignPaymentTransaction: () => ({
        transaction: "AAAA",
        nonce: `${TX_HASH}#0`,
      }),
    };
    const c = new ExactCardanoClient(omittingSigner);
    await expect(
      c.createPaymentPayload(2, buildRequirements({ extra: { submissionPolicy: "client" } })),
    ).rejects.toThrow(/honoured submissionMode undefined, expected client/);
  });

  it("rejects signer responses with invalid nonce", async () => {
    const badSigner: ClientCardanoSigner = {
      getAddress: () => "addr1q",
      buildAndSignPaymentTransaction: () => ({ transaction: "AA", nonce: "bad" }),
    };
    const c = new ExactCardanoClient(badSigner);
    await expect(c.createPaymentPayload(2, buildRequirements())).rejects.toThrow(
      /Cardano signer returned an invalid nonce/,
    );
  });
});

describe("ExactCardanoScheme facilitator", () => {
  it("requires replay persistence unless volatile storage is explicit", () => {
    expect(() => new ExactCardanoFacilitatorBase(stubFacilitatorSigner)).toThrow(
      /durable settlementStore/,
    );
  });

  it("declares CAIP family and scheme identifier", () => {
    const facilitator = new ExactCardanoFacilitator(stubFacilitatorSigner);
    expect(facilitator.scheme).toBe("exact");
    expect(facilitator.caipFamily).toBe("cardano:*");
  });

  it("returns its addresses via getSigners", () => {
    const facilitator = new ExactCardanoFacilitator(stubFacilitatorSigner);
    expect(facilitator.getSigners(CARDANO_MAINNET_CAIP2)).toEqual(["addr1qfacilitator00"]);
  });

  it("advertises its capabilities via getExtra", () => {
    const facilitator = new ExactCardanoFacilitator(stubFacilitatorSigner);
    expect(facilitator.getExtra(CARDANO_PREPROD_CAIP2)).toEqual({
      assetTransferMethods: ["default", "masumi", "script"],
      // No Hydra client is configured, so only L1 is offered.
      settlementLayers: ["l1"],
      // This stub signer has no evidence hook, so client submission is not offered.
      submissionModes: ["server"],
      l1Confirmations: {
        server: { minimum: 0, maximum: 0 },
      },
    });
  });

  it("advertises client submission once it can authenticate evidence", () => {
    const facilitator = new ExactCardanoFacilitator({
      ...stubFacilitatorSigner,
      getTransactionEvidence: async () => ({ status: "confirmed" as const, confirmations: 3 }),
    });
    const extra = facilitator.getExtra(CARDANO_PREPROD_CAIP2)!;
    expect(extra.submissionModes).toEqual(["server", "client"]);
    expect(extra.l1Confirmations).toEqual({
      server: { minimum: 0, maximum: 20 },
      client: { minimum: 0, maximum: 20 },
    });
  });

  it("advertises mempool evidence when the operator enables it", () => {
    const facilitator = new ExactCardanoFacilitator(
      {
        ...stubFacilitatorSigner,
        getTransactionEvidence: async () => ({ status: "mempool" as const, confirmations: -1 }),
      },
      { acceptMempool: true },
    );
    const extra = facilitator.getExtra(CARDANO_PREPROD_CAIP2)!;
    expect(extra.l1Confirmations).toEqual({
      server: { minimum: -1, maximum: 20 },
      client: { minimum: -1, maximum: 20 },
    });
  });

  it("does not advertise server submission without a complete phase-1 validator", () => {
    const facilitator = new ExactCardanoFacilitator({
      ...stubFacilitatorSigner,
      validatePhase1Transaction: undefined,
      getTransactionEvidence: async () => ({ status: "confirmed" as const, confirmations: 3 }),
    });
    const extra = facilitator.getExtra(CARDANO_PREPROD_CAIP2)!;
    expect(extra.submissionModes).toEqual(["client"]);
    expect(extra.l1Confirmations).toEqual({
      client: { minimum: 0, maximum: 20 },
    });
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

  it("rejects non-canonical requirements before decoding the transaction", async () => {
    const facilitator = new ExactCardanoFacilitator(stubFacilitatorSigner);
    for (const reqs of [
      buildRequirements({ amount: "0" }),
      buildRequirements({ amount: "010000" }),
      buildRequirements({ asset: USDM_MAINNET_ASSET.toUpperCase() }),
    ]) {
      const result = await facilitator.verify(
        { x402Version: 2, accepted: reqs, payload: { transaction: "AA", nonce: `${TX_HASH}#0` } },
        reqs,
      );
      expect(result.invalidReason).toBe("invalid_exact_cardano_requirements");
    }
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

  it("rejects a script payment whose payTo is not the declared script address", async () => {
    class TestFacilitator extends ExactCardanoFacilitator {}
    const facilitator = new TestFacilitator(stubFacilitatorSigner);
    const result = await (
      facilitator as unknown as {
        runMethodSpecificChecks: (
          requirements: PaymentRequirements,
          decoded: unknown,
          context: unknown,
        ) => Promise<{ ok: true } | { ok: false; reason: string }>;
      }
    ).runMethodSpecificChecks(
      buildRequirements({
        payTo: RECIPIENT,
        extra: { assetTransferMethod: "script", scriptHash: "deadbeef" },
      }),
      { outputs: [] },
      { payload: { transaction: "AA", nonce: `${TX_HASH}#0` }, payer: "addr1qpayer00" },
    );
    expect(result).toEqual({
      ok: false,
      reason: "invalid_exact_cardano_payload_script_address_mismatch",
    });
  });

  describe("settlement", () => {
    // `settle()` re-derives its state from the real transaction, so these
    // isolation tests need a decodable one. Verification itself is stubbed out
    // by overriding verify(), which settle() still dispatches through.
    let transaction: string;
    let canonicalTxHash: string;
    let reqs: PaymentRequirements;

    /** A facilitator whose verification always passes. */
    class FakeOk extends ExactCardanoFacilitator {
      override async verify() {
        return { isValid: true, payer: "addr1qpayer00" };
      }
    }

    /**
     * Builds a payment payload around the shared fixture transaction.
     *
     * @param submissionMode - Optional payload submission mode.
     * @returns The payment payload.
     */
    const payloadFor = (submissionMode?: "server" | "client") => ({
      x402Version: 2,
      accepted: reqs,
      payload: { transaction, nonce: NONCE_REF, ...(submissionMode ? { submissionMode } : {}) },
    });

    beforeAll(async () => {
      const built = await buildSignedTx({
        payTo: await freshPreprodAddress(),
        asset: LOVELACE_ASSET,
        amount: 2_000_000n,
        nonceUtxoRef: NONCE_REF,
        ttlSlot: TTL_SLOT,
        network: PREPROD,
      });
      transaction = built.transaction;
      canonicalTxHash = decodeCardanoTransaction(transaction).txHash;
      reqs = buildRequirements({ network: PREPROD, asset: LOVELACE_ASSET, amount: "2000000" });
    }, 60_000);

    it("rejects a submitter response for a different transaction id", async () => {
      const facilitator = new FakeOk(
        stubFacilitator({
          submitTransaction: async () => ({ txHash: "b".repeat(64), status: "confirmed" }),
          getTransactionEvidence: async () => ({ status: "unknown", confirmations: -2 }),
        }),
      );
      const result = await facilitator.settle(payloadFor(), reqs);
      expect(result.success).toBe(false);
      expect(result.errorReason).toBe("exact_cardano_settlement_failed");
      expect(result.errorMessage).toContain(`expected ${canonicalTxHash}`);
    });

    // The race the spec's mitigation targets: two callers reaching submission
    // before either has landed.
    it("rejects a concurrent second settle for the same transaction", async () => {
      let release: () => void = () => {};
      let signalReachedSubmit: () => void = () => {};
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      // Resolves once the first call is genuinely mid-submission, so the second
      // call races a claim that is in flight rather than one not yet taken.
      const reachedSubmit = new Promise<void>(resolve => {
        signalReachedSubmit = resolve;
      });
      let submits = 0;
      const facilitator = new FakeOk(
        stubFacilitator({
          submitTransaction: async () => {
            submits += 1;
            signalReachedSubmit();
            await gate;
            return { txHash: canonicalTxHash, status: "confirmed" };
          },
          getTransactionEvidence: async () => ({ status: "confirmed", confirmations: 1 }),
        }),
      );
      const first = facilitator.settle(payloadFor(), reqs);
      await reachedSubmit;

      const second = await facilitator.settle(payloadFor(), reqs);
      expect(second.success).toBe(false);
      expect(second.errorReason).toBe("duplicate_settlement");

      release();
      expect((await first).success).toBe(true);
      // The duplicate never reached the node.
      expect(submits).toBe(1);
    });

    it("coordinates settlement claims across facilitator instances", async () => {
      let release: () => void = () => {};
      let signalReachedSubmit: () => void = () => {};
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      const reachedSubmit = new Promise<void>(resolve => {
        signalReachedSubmit = resolve;
      });
      let submits = 0;
      const signer = stubFacilitator({
        submitTransaction: async () => {
          submits += 1;
          signalReachedSubmit();
          await gate;
          return { txHash: canonicalTxHash, status: "confirmed" };
        },
        getTransactionEvidence: async () => ({ status: "confirmed", confirmations: 1 }),
      });
      const settlementStore = new InMemoryCardanoSettlementStore();
      const firstFacilitator = new FakeOk(signer, { settlementStore });
      const secondFacilitator = new FakeOk(signer, { settlementStore });

      const first = firstFacilitator.settle(payloadFor(), reqs);
      await reachedSubmit;
      const duplicate = await secondFacilitator.settle(payloadFor(), reqs);

      expect(duplicate.success).toBe(false);
      expect(duplicate.errorReason).toBe("duplicate_settlement");
      release();
      expect((await first).success).toBe(true);
      expect(submits).toBe(1);
    });

    // A transaction that has not reached the required depth returns
    // payment_pending; the spec REQUIRES the paid retry to resume observing it
    // rather than be refused, or a fully paid payment could never be released.
    it("resumes a pending settlement on retry without submitting again", async () => {
      let submits = 0;
      let confirmations = 0;
      const facilitator = new FakeOk(
        stubFacilitator({
          submitTransaction: async () => {
            submits += 1;
            return { txHash: canonicalTxHash, status: "confirmed" };
          },
          getTransactionEvidence: async () => ({ status: "confirmed", confirmations }),
        }),
        { confirmationTimeoutMs: 1, confirmationPollMs: 1 },
      );
      const strict = buildRequirements({
        ...reqs,
        extra: { confirmationPolicy: { l1Confirmations: 2 } },
      });

      const pending = await facilitator.settle({ ...payloadFor(), accepted: strict }, strict);
      expect(pending.success).toBe(false);
      expect(pending.errorReason).toBe("payment_pending");

      // The chain advances; the retry must now succeed.
      confirmations = 2;
      const retry = await facilitator.settle({ ...payloadFor(), accepted: strict }, strict);
      expect(retry.success).toBe(true);
      expect(retry.extra).toMatchObject({ confirmations: 2 });
      expect(submits).toBe(1);
    });

    // Most providers expose no mempool read, so a just-broadcast transaction is
    // briefly indistinguishable from an unknown one. That is pending, not proof
    // the transaction does not exist.
    it("reports a just-submitted but not-yet-observable transaction as pending", async () => {
      const facilitator = new FakeOk(
        stubFacilitator({
          submitTransaction: async () => ({ txHash: canonicalTxHash, status: "mempool" }),
          getTransactionEvidence: async () => ({ status: "unknown", confirmations: -2 }),
        }),
        { confirmationTimeoutMs: 1, confirmationPollMs: 1 },
      );
      const settle = await facilitator.settle(payloadFor(), reqs);
      expect(settle.success).toBe(false);
      // Not `evidence_mismatch`: the node took it, we just cannot see it yet.
      expect(settle.errorReason).toBe("exact_cardano_settlement_not_confirmed");
      expect(settle.extra).toMatchObject({ status: "mempool" });
    });

    // A signer that broadcasts and then waits for inclusion throws on a
    // confirmation timeout with the transaction already in flight. Releasing the
    // claim there would make the retry rebroadcast a transaction that may
    // already have landed — and typically fail on spent inputs, leaving the
    // payer charged with no resource.
    it("keeps the claim when submission throws after the transaction landed", async () => {
      let submits = 0;
      const facilitator = new FakeOk(
        stubFacilitator({
          submitTransaction: async () => {
            submits += 1;
            // Broadcast succeeded; the wait for confirmation did not.
            throw new Error("timed out awaiting confirmation");
          },
          // The ledger nonetheless has it.
          getTransactionEvidence: async () => ({ status: "confirmed", confirmations: 1 }),
        }),
        { confirmationTimeoutMs: 1, confirmationPollMs: 1 },
      );

      // The throw is recovered from: the transaction is on-chain, so this
      // settles rather than reporting a failed payment.
      const first = await facilitator.settle(payloadFor(), reqs);
      expect(first.success).toBe(true);
      expect(first.extra).toMatchObject({ confirmations: 1 });

      // And the retry resumes observation without a second broadcast.
      const retry = await facilitator.settle(payloadFor(), reqs);
      expect(retry.success).toBe(true);
      expect(submits).toBe(1);
    });

    it("tombstones a transaction after definitive pre-ledger rejection", async () => {
      let submits = 0;
      const facilitator = new FakeOk(
        stubFacilitator({
          submitTransaction: async () => {
            submits += 1;
            throw new Error("BadInputsUTxO (input already spent)");
          },
          getTransactionEvidence: async () => ({ status: "unknown", confirmations: -2 }),
          isDefinitiveSubmissionRejection: error =>
            error instanceof Error && error.message.includes("BadInputsUTxO"),
        }),
      );
      const failed = await facilitator.settle(payloadFor(), reqs);
      expect(failed.success).toBe(false);
      expect(failed.errorReason).toBe("exact_cardano_settlement_definitively_rejected");
      expect(failed.errorMessage).toContain("BadInputsUTxO");

      // The handler already ran before settlement. Reusing or replacing this
      // payment could bind that result to different bytes, so the quote is now
      // terminal and the rejected transaction is never broadcast again.
      const retry = await facilitator.settle(payloadFor(), reqs);
      expect(retry.errorReason).toBe("exact_cardano_settlement_definitively_rejected");
      expect(submits).toBe(1);
    });

    it("retains the claim after an ambiguous submission failure", async () => {
      let submits = 0;
      const facilitator = new FakeOk(
        stubFacilitator({
          submitTransaction: async () => {
            submits += 1;
            throw new Error("provider connection closed");
          },
          getTransactionEvidence: async () => ({ status: "unknown", confirmations: -2 }),
        }),
        { confirmationTimeoutMs: 1, confirmationPollMs: 1 },
      );
      const first = await facilitator.settle(payloadFor(), reqs);
      expect(first.success).toBe(false);
      expect(first.transaction).toBe(decodeCardanoTransaction(transaction).txHash);
      await facilitator.settle(payloadFor(), reqs);
      expect(submits).toBe(1);
    });

    it("refuses a retry that flips the normalized submission mode", async () => {
      const facilitator = new FakeOk(stubFacilitator());
      const either = buildRequirements({ ...reqs, extra: { submissionPolicy: "either" } });
      const first = await facilitator.settle({ ...payloadFor("server"), accepted: either }, either);
      expect(first.success).toBe(true);
      const flipped = await facilitator.settle(
        { ...payloadFor("client"), accepted: either },
        either,
      );
      expect(flipped.success).toBe(false);
      expect(flipped.errorReason).toBe("invalid_exact_cardano_payload_submission_mode_mismatch");
    });

    it("reports the strongest verified evidence in the response extra", async () => {
      const facilitator = new FakeOk(
        stubFacilitator({
          getTransactionEvidence: async () => ({ status: "confirmed", confirmations: 4 }),
        }),
      );
      const settle = await facilitator.settle(payloadFor(), reqs);
      expect(settle.success).toBe(true);
      expect(settle.extra).toMatchObject({
        status: "confirmed",
        submissionMode: "server",
        confirmations: 4,
      });
    });

    it("reports payment_pending when evidence is below the confirmation policy", async () => {
      const facilitator = new FakeOk(
        stubFacilitator({
          getTransactionEvidence: async () => ({ status: "confirmed", confirmations: 0 }),
        }),
        { confirmationTimeoutMs: 1, confirmationPollMs: 1 },
      );
      const strict = buildRequirements({
        ...reqs,
        extra: { confirmationPolicy: { l1Confirmations: 3 } },
      });
      const settle = await facilitator.settle({ ...payloadFor(), accepted: strict }, strict);
      expect(settle.success).toBe(false);
      expect(settle.errorReason).toBe("payment_pending");
      expect(settle.extra).toMatchObject({ status: "pending", confirmations: 0 });
    });

    it("rejects mempool-only settlements when acceptMempool is disabled (default)", async () => {
      const facilitator = new FakeOk(
        stubFacilitator({
          submitTransaction: async () => ({ txHash: canonicalTxHash, status: "mempool" }),
          getTransactionEvidence: undefined,
        }),
      );
      const settle = await facilitator.settle(payloadFor(), reqs);
      expect(settle.success).toBe(false);
      expect(settle.errorReason).toBe("exact_cardano_settlement_not_confirmed");
    });

    it("accepts mempool-only settlements when acceptMempool is true and the policy allows -1", async () => {
      const facilitator = new FakeOk(
        stubFacilitator({
          submitTransaction: async () => ({ txHash: canonicalTxHash, status: "mempool" }),
          getTransactionEvidence: undefined,
        }),
        { acceptMempool: true },
      );
      const lenient = buildRequirements({
        ...reqs,
        extra: { confirmationPolicy: { l1Confirmations: -1 } },
      });
      const settle = await facilitator.settle({ ...payloadFor(), accepted: lenient }, lenient);
      expect(settle.success).toBe(true);
      expect(settle.extra).toMatchObject({ status: "mempool", confirmations: -1 });
    });

    it("surfaces the underlying error message when submission throws", async () => {
      const facilitator = new FakeOk(
        stubFacilitator({
          submitTransaction: async () => {
            throw new Error("BadInputsUTxO (input already spent)");
          },
        }),
      );
      const settle = await facilitator.settle(payloadFor(), reqs);
      expect(settle.success).toBe(false);
      expect(settle.errorReason).toBe("exact_cardano_settlement_failed");
      expect(settle.errorMessage).toContain("BadInputsUTxO");
    });

    it("never submits in client mode, settling from authenticated evidence alone", async () => {
      let submitted = 0;
      const facilitator = new FakeOk(
        stubFacilitator({
          submitTransaction: async () => {
            submitted += 1;
            return { txHash: "abc", status: "confirmed" };
          },
          getTransactionEvidence: async () => ({ status: "confirmed", confirmations: 2 }),
        }),
      );
      const clientReqs = buildRequirements({
        ...reqs,
        extra: { submissionPolicy: "client" },
      });
      const settle = await facilitator.settle(
        { ...payloadFor("client"), accepted: clientReqs },
        clientReqs,
      );
      expect(settle.success).toBe(true);
      expect(submitted).toBe(0);
      expect(settle.extra).toMatchObject({ submissionMode: "client", confirmations: 2 });
    });

    it("refuses a payload whose mode the policy does not allow", async () => {
      const facilitator = new FakeOk(stubFacilitator());
      const serverOnly = buildRequirements({ ...reqs, extra: { submissionPolicy: "server" } });
      const settle = await facilitator.settle(
        { ...payloadFor("client"), accepted: serverOnly },
        serverOnly,
      );
      expect(settle.success).toBe(false);
      expect(settle.errorReason).toBe("invalid_exact_cardano_payload_submission_mode_mismatch");
    });
  });
});

describe("ExactCardanoScheme server", () => {
  it("requires replay persistence unless volatile storage is explicit", () => {
    expect(() => new ExactCardanoServerBase()).toThrow(/durable operationStore/);
  });

  it("awaits asynchronous bodies and prefers exact raw bytes", async () => {
    const asyncBody = await serverReplayFixture();
    const asyncAdapter = asyncBody.transportContext.request.adapter;
    asyncAdapter.getBody = async () => ({ job: 1 });
    const asyncServer = new ExactCardanoServer({ requestBinding: () => "test-requester" });
    expect(await asyncServer.schemeHooks.onAfterVerify!(asyncBody.context)).toBeUndefined();

    const rawBody = await serverReplayFixture();
    const rawAdapter = rawBody.transportContext.request.adapter as typeof asyncAdapter & {
      getRawBody(): Promise<Uint8Array>;
    };
    rawAdapter.getBody = () => {
      throw new Error("parsed body must not be read when raw bytes are available");
    };
    rawAdapter.getRawBody = async () => new TextEncoder().encode('{ "job": 1 }');
    const rawServer = new ExactCardanoServer({ requestBinding: () => "test-requester" });
    expect(await rawServer.schemeHooks.onAfterVerify!(rawBody.context)).toBeUndefined();
  });

  it("claims the payment before the handler and replays its stored result", async () => {
    const payTo = await freshPreprodAddress();
    const built = await buildSignedTx({
      payTo,
      asset: LOVELACE_ASSET,
      amount: 2_000_000n,
      nonceUtxoRef: NONCE_REF,
      ttlSlot: TTL_SLOT,
      network: PREPROD,
    });
    const requirements = buildRequirements({
      network: PREPROD,
      payTo,
      asset: LOVELACE_ASSET,
      amount: "2000000",
    });
    const paymentPayload = {
      x402Version: 2,
      accepted: requirements,
      payload: { transaction: built.transaction, nonce: built.nonce },
    };
    const transport = (body: unknown, headers: Record<string, string> = {}) => ({
      request: {
        method: "POST",
        adapter: {
          getMethod: () => "POST",
          getUrl: () => "https://example.com/jobs",
          getHeader: (name: string) => headers[name.toLowerCase()],
          getBody: () => body,
        },
      },
    });
    const hookContext = (transportContext: ReturnType<typeof transport>) => ({
      paymentPayload,
      requirements,
      declaredExtensions: {},
      transportContext,
      result: { isValid: true, payer: "addr_test1payer" },
    });

    const operationStore = new InMemoryCardanoOperationStore();
    const requestBinding = ({ getHeader }: { getHeader(name: string): string | undefined }) =>
      getHeader("authorization") ?? "";
    const server = new ExactCardanoServer({ operationStore, requestBinding });
    const peerServer = new ExactCardanoServer({ operationStore, requestBinding });
    const hooks = server.schemeHooks;
    const peerHooks = peerServer.schemeHooks;
    const requesterHeaders = {
      "content-type": "application/json",
      authorization: "Bearer owner-token",
    };
    const owner = transport({ job: 1 }, requesterHeaders);
    expect(
      await hooks.onAfterVerify!({
        ...hookContext(owner),
        result: { isValid: false, invalidReason: "input_unavailable", payer: "" },
      }),
    ).toBeUndefined();
    expect(await hooks.onAfterVerify!(hookContext(owner))).toBeUndefined();

    const concurrent = transport({ job: 1 }, requesterHeaders);
    expect(await peerHooks.onAfterVerify!(hookContext(concurrent))).toMatchObject({
      abort: true,
      reason: "duplicate_settlement",
    });
    // Canceling the rejected duplicate must not release the original claim.
    await peerHooks.onVerifiedPaymentCanceled!({
      ...hookContext(concurrent),
      reason: "after_verify_aborted",
    });
    expect(
      await peerHooks.onAfterVerify!(hookContext(transport({ job: 1 }, requesterHeaders))),
    ).toMatchObject({ abort: true });

    await hooks.onAfterSettle!({
      ...hookContext({
        ...owner,
        responseBody: Buffer.from('{"jobId":"job-1"}'),
        responseHeaders: {
          "content-type": "application/json",
          "x-job": "job-1",
          "set-cookie": "session=private",
          "www-authenticate": "Bearer realm=private",
        },
        responseStatus: 201,
      }),
      result: {
        success: false,
        transaction: decodeCardanoTransaction(built.transaction).txHash,
        network: PREPROD,
        errorReason: "payment_pending",
      },
    });

    const retry = await peerHooks.onAfterVerify!(
      hookContext(transport({ job: 1 }, requesterHeaders)),
    );
    expect(retry).toEqual({
      skipHandler: true,
      response: {
        status: 201,
        contentType: "application/json",
        headers: { "x-job": "job-1" },
        body: Buffer.from('{"jobId":"job-1"}'),
        isRaw: true,
      },
    });
    expect(
      await hooks.onAfterVerify!(
        hookContext(
          transport({ job: 1 }, { ...requesterHeaders, authorization: "Bearer other-token" }),
        ),
      ),
    ).toMatchObject({
      abort: true,
      reason: "payment_replay_conflict",
      status: 409,
    });
    expect(
      await hooks.onAfterVerify!(hookContext(transport({ job: 2 }, requesterHeaders))),
    ).toMatchObject({
      abort: true,
      reason: "payment_replay_conflict",
      status: 409,
    });
  });

  it("replays an anonymous result only with the original 402 challenge", async () => {
    const fixture = await serverReplayFixture();
    const adapter = fixture.transportContext.request.adapter;
    adapter.getHeader = name => (name === "content-type" ? "application/json" : undefined);
    const server = new ExactCardanoServer();
    const originalChallenge = await attachReplayChallenge(server, fixture);

    expect(await server.schemeHooks.onAfterVerify!(fixture.context)).toBeUndefined();
    await server.schemeHooks.onAfterSettle!({
      ...fixture.context,
      transportContext: {
        ...fixture.transportContext,
        responseBody: Buffer.from('{"jobId":"job-1"}'),
        responseHeaders: { "content-type": "application/json" },
        responseStatus: 200,
      },
      result: { success: true, transaction: "abc", network: PREPROD },
    });

    const retry = await server.schemeHooks.onAfterVerify!(fixture.context);
    expect(retry).toMatchObject({
      skipHandler: true,
      response: { status: 200, body: Buffer.from('{"jobId":"job-1"}'), isRaw: true },
    });

    const attackerChallenge = await attachReplayChallenge(server, fixture);
    expect(attackerChallenge).not.toBe(originalChallenge);
    expect(await server.schemeHooks.onAfterVerify!(fixture.context)).toMatchObject({
      abort: true,
      reason: "payment_replay_binding_required",
      status: 403,
    });
  });

  it("does not reflect an invented challenge into a later 402 response", async () => {
    const fixture = await serverReplayFixture();
    const server = new ExactCardanoServer();
    await attachReplayChallenge(server, fixture);
    const replayProtection = fixture.context.paymentPayload.extensions?.cardanoReplayProtection as {
      challenges: Record<string, string>;
    };
    const requirementKey = Object.keys(replayProtection.challenges)[0]!;
    const invented = "f".repeat(64);
    replayProtection.challenges[requirementKey] = invented;

    const returned = await attachReplayChallenge(server, fixture, true);
    expect(returned).not.toBe(invented);
  });

  it("does not treat arbitrary authorization headers as authenticated request binding", async () => {
    const fixture = await serverReplayFixture();
    fixture.context.paymentPayload.payload.submissionMode = "client";

    const operationStore = new InMemoryCardanoOperationStore();
    const server = new ExactCardanoServer({ operationStore });
    expect(await server.schemeHooks.onAfterVerify!(fixture.context)).toMatchObject({
      abort: true,
      reason: "payment_replay_binding_required",
      status: 403,
    });

    await attachReplayChallenge(server, fixture);
    expect(await server.schemeHooks.onAfterVerify!(fixture.context)).toMatchObject({
      abort: true,
      reason: "payment_replay_binding_required",
      status: 403,
    });

    const authenticatedServer = new ExactCardanoServer({
      operationStore,
      requestBinding: () => "validated-owner",
    });
    await attachReplayChallenge(authenticatedServer, fixture);
    expect(await authenticatedServer.schemeHooks.onAfterVerify!(fixture.context)).toBeUndefined();
  });

  it("retains an ambiguous tombstone when a handler throws or fails", async () => {
    const fixture = await serverReplayFixture();
    const server = new ExactCardanoServer({ requestBinding: () => "test-requester" });
    expect(await server.schemeHooks.onAfterVerify!(fixture.context)).toBeUndefined();
    await server.schemeHooks.onVerifiedPaymentCanceled!({
      ...fixture.context,
      reason: "handler_threw",
    });

    expect(await server.schemeHooks.onAfterVerify!(fixture.context)).toMatchObject({
      abort: true,
      reason: "payment_replay_outcome_ambiguous",
      status: 409,
    });
  });

  it("marks the operation ambiguous when no handler response bytes are available", async () => {
    const fixture = await serverReplayFixture();
    const server = new ExactCardanoServer({ requestBinding: () => "test-requester" });
    expect(await server.schemeHooks.onAfterVerify!(fixture.context)).toBeUndefined();
    await server.schemeHooks.onAfterSettle!({
      ...fixture.context,
      result: { success: true, transaction: "abc", network: PREPROD },
    });

    expect(await server.schemeHooks.onAfterVerify!(fixture.context)).toMatchObject({
      abort: true,
      reason: "payment_replay_outcome_ambiguous",
      status: 409,
    });
  });

  it("rejects replay protection when hooks have no stable request adapter", async () => {
    const fixture = await serverReplayFixture();
    const server = new ExactCardanoServer({ requestBinding: () => "test-requester" });
    const context = {
      ...fixture.context,
      transportContext: { request: { method: "POST" } },
    };

    expect(await server.schemeHooks.onAfterVerify!(context)).toMatchObject({
      abort: true,
      reason: "payment_replay_store_unavailable",
      status: 503,
    });
  });

  it("makes a definitive settlement rejection terminal for the protected operation", async () => {
    const fixture = await serverReplayFixture();
    const server = new ExactCardanoServer({ requestBinding: () => "test-requester" });
    expect(await server.schemeHooks.onAfterVerify!(fixture.context)).toBeUndefined();

    await server.schemeHooks.onSettleFailure!({
      ...fixture.context,
      transportContext: {
        ...fixture.transportContext,
        responseBody: Buffer.from('{"jobId":"job-1"}'),
        responseHeaders: { "content-type": "application/json" },
        responseStatus: 200,
      },
      result: {
        success: false,
        transaction: "abc",
        network: PREPROD,
        errorReason: "exact_cardano_settlement_definitively_rejected",
      },
    });

    expect(await server.schemeHooks.onAfterVerify!(fixture.context)).toMatchObject({
      abort: true,
      reason: "payment_replay_outcome_ambiguous",
      status: 409,
    });
  });

  it("fails closed when replay persistence or body canonicalization fails", async () => {
    const fixture = await serverReplayFixture(new Map([["job", 1]]));
    const invalidBodyServer = new ExactCardanoServer();
    expect(await invalidBodyServer.schemeHooks.onAfterVerify!(fixture.context)).toMatchObject({
      abort: true,
      reason: "payment_replay_store_unavailable",
      status: 503,
    });

    const unavailableStore = new InMemoryCardanoOperationStore();
    unavailableStore.claim = async () => {
      throw new Error("database unavailable");
    };
    const unavailableServer = new ExactCardanoServer({
      operationStore: unavailableStore,
      requestBinding: () => "test-requester",
    });
    expect(await unavailableServer.schemeHooks.onAfterVerify!(fixture.context)).toMatchObject({
      abort: true,
      reason: "payment_replay_store_unavailable",
      status: 503,
    });
  });

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

  it("rejects non-canonical AssetAmount values before issuing requirements", async () => {
    const server = new ExactCardanoServer();
    await expect(
      server.parsePrice({ amount: "0", asset: LOVELACE_ASSET }, CARDANO_MAINNET_CAIP2),
    ).rejects.toThrow(/positive canonical integer/);
    await expect(
      server.parsePrice({ amount: "001", asset: LOVELACE_ASSET }, CARDANO_MAINNET_CAIP2),
    ).rejects.toThrow(/positive canonical integer/);
    await expect(
      server.parsePrice(
        { amount: "1", asset: USDM_MAINNET_ASSET.toUpperCase() },
        CARDANO_MAINNET_CAIP2,
      ),
    ).rejects.toThrow(/canonical lowercase Cardano form/);
  });

  it("rejects non-canonical custom money parser results", async () => {
    const server = new ExactCardanoServer();
    server.registerMoneyParser(async () => ({
      amount: "01",
      asset: USDM_MAINNET_ASSET,
    }));
    await expect(server.parsePrice("1", CARDANO_MAINNET_CAIP2)).rejects.toThrow(
      /positive canonical integer/,
    );
  });

  it("rejects a Money value that rounds to zero atomic units", async () => {
    const server = new ExactCardanoServer();
    await expect(server.parsePrice("$0.0000001", CARDANO_MAINNET_CAIP2)).rejects.toThrow(
      /too small to represent/,
    );
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

  // `/supported` extra is capability advertisement, not payload semantics.
  // Merging it into the requirements would put `assetTransferMethods`,
  // `settlementLayers` and friends inside `extra` — and the Masumi `extra` is a
  // CLOSED object, so every Masumi 402 would be invalid on arrival.
  it("enhancePaymentRequirements leaves the requirements' extra untouched", async () => {
    const server = new ExactCardanoServer();
    const baseRequirements = buildRequirements({ extra: { foo: "bar" } });
    const enhanced = await server.enhancePaymentRequirements(
      baseRequirements,
      {
        x402Version: 2,
        scheme: "exact",
        network: CARDANO_MAINNET_CAIP2,
        extra: {
          assetTransferMethods: ["default", "masumi", "script"],
          settlementLayers: ["l1"],
          submissionModes: ["server", "client"],
          l1Confirmations: {
            server: { minimum: 0, maximum: 20 },
            client: { minimum: 0, maximum: 20 },
          },
        },
      },
      [],
    );
    expect(enhanced.extra).toEqual({ foo: "bar" });
  });

  // A facilitator that publishes an `extra` has claimed to describe itself, so a
  // capability this scheme selects and cannot find there is a rejection — not
  // silent permission to serve a 402 nobody can settle.
  it("rejects a half-filled facilitator capability advertisement", async () => {
    const server = new ExactCardanoServer();
    await expect(
      server.enhancePaymentRequirements(
        buildRequirements(),
        {
          x402Version: 2,
          scheme: "exact",
          network: CARDANO_MAINNET_CAIP2,
          extra: { assetTransferMethods: ["default"], settlementLayers: ["l1"] },
        },
        [],
      ),
    ).rejects.toThrow(/did not advertise submissionModes/);
  });

  it("accepts requirements when the facilitator advertises no capabilities at all", async () => {
    const server = new ExactCardanoServer();
    const enhanced = await server.enhancePaymentRequirements(
      buildRequirements({ extra: { foo: "bar" } }),
      { x402Version: 2, scheme: "exact", network: CARDANO_MAINNET_CAIP2 },
      [],
    );
    expect(enhanced.extra).toEqual({ foo: "bar" });
  });

  it("rejects requirements whose submission mode is not advertised", async () => {
    const server = new ExactCardanoServer();
    await expect(
      server.enhancePaymentRequirements(
        buildRequirements(),
        {
          x402Version: 2,
          scheme: "exact",
          network: CARDANO_MAINNET_CAIP2,
          extra: {
            assetTransferMethods: ["default"],
            settlementLayers: ["l1"],
            submissionModes: ["client"],
            l1Confirmations: { client: { minimum: 0, maximum: 20 } },
          },
        },
        [],
      ),
    ).rejects.toThrow(/does not support server submission/);
  });

  it("rejects requirements outside the advertised confirmation range", async () => {
    const server = new ExactCardanoServer();
    await expect(
      server.enhancePaymentRequirements(
        buildRequirements({
          extra: { submissionPolicy: "server", confirmationPolicy: { l1Confirmations: 1 } },
        }),
        {
          x402Version: 2,
          scheme: "exact",
          network: CARDANO_MAINNET_CAIP2,
          extra: {
            assetTransferMethods: ["default"],
            settlementLayers: ["l1"],
            submissionModes: ["server"],
            l1Confirmations: { server: { minimum: 0, maximum: 0 } },
          },
        },
        [],
      ),
    ).rejects.toThrow(/confirmation range does not include 1/);
  });

  it("keeps an issued Masumi extra schema-valid through enhancement", async () => {
    const { requirements } = await issueMasumiRequirements({
      network: CARDANO_PREPROD_CAIP2,
      asset: LOVELACE_ASSET,
      amount: "5000000",
      payByTimeMs: 1_785_756_000_000n,
      confirmationPolicy: { l1Confirmations: 0 },
    });
    const server = new ExactCardanoServer();
    const enhanced = await server.enhancePaymentRequirements(
      requirements,
      {
        x402Version: 2,
        scheme: "exact",
        network: CARDANO_PREPROD_CAIP2,
        extra: new ExactCardanoFacilitator(stubFacilitator()).getExtra(CARDANO_PREPROD_CAIP2),
      },
      [],
    );
    expect(validateMasumiExtra(enhanced.extra, CARDANO_PREPROD_CAIP2).ok).toBe(true);
  });
});
