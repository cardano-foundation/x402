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
const PAY_BY_TIME = 1_785_756_000_000n;

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
    submitResultTime: (PAY_BY_TIME + 300_000n).toString(),
    unlockTime: (PAY_BY_TIME + 1_200_000n).toString(),
    externalDisputeUnlockTime: (PAY_BY_TIME + 2_100_000n).toString(),
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
});
