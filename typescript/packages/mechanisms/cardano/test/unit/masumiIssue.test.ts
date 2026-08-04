import { PrivateKey } from "@evolution-sdk/evolution";
import { describe, expect, it } from "vitest";

import { CARDANO_PREPROD_CAIP2, CARDANO_PREVIEW_CAIP2, LOVELACE_ASSET } from "../../src/constants";
import { MASUMI_DEFAULT_DEPLOYMENT, masumiEscrowAddress } from "../../src/exact/masumi/blueprint";
import { issueMasumiRequirements, toMasumiSellerSigner } from "../../src/exact/masumi/issue";
import { validateMasumiExtra } from "../../src/exact/masumi/schema";
import { verifyMasumiAuthorization } from "../../src/exact/masumi/verify";
import type { CardanoExtraMasumi } from "../../src/types";
import { MAX_MASUMI_COMMITMENT_PARTS } from "../../src/limits";

const NETWORK = CARDANO_PREPROD_CAIP2;
// The issuer enforces absolute deadline floors against its own clock, so the
// happy-path fixture has to be anchored to now rather than to a fixed instant.
// `payByTime` sits inside `maxTimeoutSeconds` (10 minutes) while
// `submitResultTime` clears the 15-minute lead Masumi requires.
const PAY_BY_TIME = BigInt(Date.now() + 9 * 60 * 1000);
const SUBMIT_RESULT_TIME = PAY_BY_TIME + 7n * 60n * 1000n;
const UNLOCK_TIME = SUBMIT_RESULT_TIME + 20n * 60n * 1000n;
const EXTERNAL_DISPUTE_UNLOCK_TIME = UNLOCK_TIME + 20n * 60n * 1000n;

/**
 * Issues a 402 with a mnemonic-backed seller, i.e. the way a resource server
 * that holds its selling wallet would.
 *
 * @param overrides - Fields to override on the issuance input.
 * @returns The issued requirements plus the seller address.
 */
async function issue(overrides: Record<string, unknown> = {}) {
  const seller = toMasumiSellerSigner({
    mnemonic: PrivateKey.generateMnemonic(),
    network: NETWORK,
  });
  const requirements = await issueMasumiRequirements({
    network: NETWORK,
    asset: LOVELACE_ASSET,
    amount: "50000000",
    maxTimeoutSeconds: 600,
    sellerAddress: seller.sellerAddress,
    signTerms: seller.signTerms,
    commitment: [
      {
        name: "body",
        canonicalization: "jcs",
        mediaType: "application/json",
        content: { days: 3, units: "metric" },
      },
    ],
    payByTime: PAY_BY_TIME.toString(),
    submitResultTime: SUBMIT_RESULT_TIME.toString(),
    unlockTime: UNLOCK_TIME.toString(),
    externalDisputeUnlockTime: EXTERNAL_DISPUTE_UNLOCK_TIME.toString(),
    ...overrides,
  });
  return { requirements, sellerAddress: seller.sellerAddress };
}

describe("issueMasumiRequirements", () => {
  it("issues requirements that pass the wire schema and the seller authorization", async () => {
    const { requirements, sellerAddress } = await issue();
    const schema = validateMasumiExtra(requirements.extra, NETWORK);
    expect(schema.ok).toBe(true);

    const authorization = await verifyMasumiAuthorization(
      (schema as { ok: true; extra: CardanoExtraMasumi }).extra,
      requirements,
    );
    expect(authorization).toMatchObject({ ok: true });
    expect((requirements.extra as unknown as CardanoExtraMasumi).terms.sellerAddress).toBe(
      sellerAddress,
    );
  });

  it("derives payTo from the deployment rather than accepting one", async () => {
    const { requirements } = await issue();
    expect(requirements.payTo).toBe(masumiEscrowAddress(NETWORK, MASUMI_DEFAULT_DEPLOYMENT));
  });

  it("generates a fresh 32-byte seller nonce per issuance", async () => {
    const first = (await issue()).requirements.extra as unknown as CardanoExtraMasumi;
    const second = (await issue()).requirements.extra as unknown as CardanoExtraMasumi;
    expect(first.terms.sellerNonce).toMatch(/^[0-9a-f]{64}$/);
    expect(first.terms.sellerNonce).not.toBe(second.terms.sellerNonce);
  });

  it("rejects requirements that exceed Masumi collection budgets", async () => {
    const { requirements } = await issue();
    const extra = structuredClone(requirements.extra) as unknown as CardanoExtraMasumi;
    extra.inputCommitment.parts = Array.from(
      { length: MAX_MASUMI_COMMITMENT_PARTS + 1 },
      (_, index) => ({
        name: `part-${index}`,
        canonicalization: "jcs" as const,
        content: index,
        digest: "00".repeat(32),
      }),
    );
    expect(validateMasumiExtra(extra, NETWORK)).toMatchObject({ ok: false });
  });

  it("accepts shared JSON values but rejects an actual content cycle", async () => {
    const shared = { units: "metric" };
    const { requirements } = await issue({
      commitment: [
        {
          name: "body",
          canonicalization: "jcs",
          content: { first: shared, second: shared },
        },
      ],
    });
    expect(validateMasumiExtra(requirements.extra, NETWORK)).toMatchObject({ ok: true });

    const extra = structuredClone(requirements.extra) as unknown as CardanoExtraMasumi;
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    extra.inputCommitment.parts[0]!.content = cyclic;
    expect(validateMasumiExtra(extra, NETWORK)).toMatchObject({ ok: false });
  });

  it("keeps inputHash stable when a part's content is not echoed on the wire", async () => {
    const echoed = await issue();
    const withheld = await issue({
      sellerNonce: (echoed.requirements.extra as unknown as CardanoExtraMasumi).terms.sellerNonce,
      commitment: [
        {
          name: "body",
          canonicalization: "jcs",
          mediaType: "application/json",
          content: { days: 3, units: "metric" },
          echoContent: false,
        },
      ],
    });
    const echoedExtra = echoed.requirements.extra as unknown as CardanoExtraMasumi;
    const withheldExtra = withheld.requirements.extra as unknown as CardanoExtraMasumi;
    expect(withheldExtra.inputCommitment.parts[0].content).toBeUndefined();
    expect(withheldExtra.inputCommitment.digest).toBe(echoedExtra.inputCommitment.digest);
    expect(withheldExtra.terms.inputHash).toBe(echoedExtra.terms.inputHash);
  });

  it("refuses to issue on a network with no canonical deployment", async () => {
    await expect(issue({ network: CARDANO_PREVIEW_CAIP2 })).rejects.toThrow(
      /no canonical Masumi deployment/,
    );
  });

  it("refuses to serve requirements that would fail the wire schema", async () => {
    await expect(issue({ buyerNonce: "01" })).rejects.toThrow(/Issued Masumi requirements/);
  });

  it("rejects non-canonical amount and asset values before signing", async () => {
    await expect(issue({ amount: "0" })).rejects.toThrow(/positive canonical integer/);
    await expect(issue({ amount: "050000000" })).rejects.toThrow(/positive canonical integer/);
    await expect(issue({ asset: `AA${"00".repeat(27)}.` })).rejects.toThrow(
      /canonical lowercase form/,
    );
  });

  // Every value below is covered by `termsDigest`, so a 402 that trips one of
  // these cannot be repaired afterwards — only re-issued. Catching it here is
  // the difference between an immediate error and a 402 no buyer will ever pay.
  describe("issuer-side policy", () => {
    it("rejects deadline gaps below the minimum", async () => {
      await expect(issue({ submitResultTime: (PAY_BY_TIME + 60_000n).toString() })).rejects.toThrow(
        /deadline intervals are below the minimum/,
      );
      await expect(
        issue({ unlockTime: (SUBMIT_RESULT_TIME + 60_000n).toString() }),
      ).rejects.toThrow(/deadline intervals are below the minimum/);
      await expect(
        issue({ externalDisputeUnlockTime: (UNLOCK_TIME + 60_000n).toString() }),
      ).rejects.toThrow(/deadline intervals are below the minimum/);
    });

    it("rejects a payByTime that has already passed", async () => {
      const past = BigInt(Date.now() - 60_000);
      await expect(
        issue({
          payByTime: past.toString(),
          submitResultTime: (past + 7n * 60n * 1000n).toString(),
          unlockTime: (past + 27n * 60n * 1000n).toString(),
          externalDisputeUnlockTime: (past + 47n * 60n * 1000n).toString(),
        }),
      ).rejects.toThrow(/payByTime must be in the future/);
    });

    it("rejects a submitResultTime inside Masumi's 15-minute lead", async () => {
      const payByTime = BigInt(Date.now() + 60_000);
      const submitResultTime = payByTime + 6n * 60n * 1000n;
      await expect(
        issue({
          payByTime: payByTime.toString(),
          submitResultTime: submitResultTime.toString(),
          unlockTime: (submitResultTime + 20n * 60n * 1000n).toString(),
          externalDisputeUnlockTime: (submitResultTime + 40n * 60n * 1000n).toString(),
        }),
      ).rejects.toThrow(/submitResultTime must be at least 15 minutes away/);
    });

    it("rejects a payByTime the buyer could not reach inside maxTimeoutSeconds", async () => {
      await expect(issue({ maxTimeoutSeconds: 60 })).rejects.toThrow(
        /payByTime exceeds maxTimeoutSeconds/,
      );
    });

    it("rejects a non-positive maxTimeoutSeconds even with policy checks skipped", async () => {
      await expect(issue({ maxTimeoutSeconds: 0 })).rejects.toThrow(
        /maxTimeoutSeconds must be a positive safe integer/,
      );
      // `maxTimeoutSeconds` goes into `termsDigest`, so its validity is not part
      // of the skippable policy surface.
      await expect(issue({ maxTimeoutSeconds: -1, unsafeSkipPolicyChecks: true })).rejects.toThrow(
        /maxTimeoutSeconds must be a positive safe integer/,
      );
    });

    // `vested_pay` gates the buyer's WithdrawRefund on submit_result_time, so an
    // unbounded deadline freezes the payment AND the collateral for that long.
    it("rejects deadlines beyond the accepted horizon", async () => {
      const farOut = BigInt(Date.now() + 400 * 24 * 60 * 60 * 1000);
      await expect(issue({ externalDisputeUnlockTime: farOut.toString() })).rejects.toThrow(
        /deadlines extend beyond the accepted horizon/,
      );
    });

    // Named rejections, not a raw `SyntaxError` escaping from `BigInt`.
    it("rejects unparseable deadlines with a named error", async () => {
      await expect(issue({ payByTime: "" })).rejects.toThrow(
        /payByTime must be a positive POSIX-ms integer string/,
      );
      await expect(issue({ submitResultTime: "12x" })).rejects.toThrow(
        /submitResultTime must be a positive POSIX-ms integer string/,
      );
      await expect(issue({ unlockTime: "-1" })).rejects.toThrow(
        /unlockTime must be a positive POSIX-ms integer string/,
      );
      await expect(issue({ externalDisputeUnlockTime: "9".repeat(21) })).rejects.toThrow(
        /externalDisputeUnlockTime must be a positive POSIX-ms integer string/,
      );
    });
  });
});
