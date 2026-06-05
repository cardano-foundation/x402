import { describe, expect, it } from "vitest";
import { preprod, PrivateKey } from "@evolution-sdk/evolution";
import { toFacilitatorCardanoSigner } from "../../src/signer";
import { CARDANO_MAINNET_CAIP2, CARDANO_PREPROD_CAIP2 } from "../../src/constants";

const makeSigner = (): ReturnType<typeof toFacilitatorCardanoSigner> =>
  toFacilitatorCardanoSigner({
    mnemonic: PrivateKey.generateMnemonic(),
    network: CARDANO_PREPROD_CAIP2,
    // Never contacted by getCurrentSlot / network-guard paths.
    provider: { blockfrost: { baseUrl: "http://offline.invalid" } },
  });

describe("toFacilitatorCardanoSigner", () => {
  it("derives the current slot from the chain slot config (no network)", async () => {
    const signer = makeSigner();
    const slot = await signer.getCurrentSlot(CARDANO_PREPROD_CAIP2);

    const sc = preprod.slotConfig;
    const expected =
      sc.zeroSlot + BigInt(Math.floor((Date.now() - Number(sc.zeroTime)) / sc.slotLength));

    // Allow a few slots of drift between the two Date.now() reads.
    const drift = slot - expected;
    expect(drift >= -2n && drift <= 2n).toBe(true);
    expect(slot).toBeGreaterThan(sc.zeroSlot);
  });

  it("rejects chain queries for a network it was not configured for", async () => {
    const signer = makeSigner();
    await expect(signer.getCurrentSlot(CARDANO_MAINNET_CAIP2)).rejects.toThrow(
      /configured for cardano:preprod/,
    );
    await expect(signer.getUtxo(`${"a".repeat(64)}#0`, CARDANO_MAINNET_CAIP2)).rejects.toThrow(
      /configured for cardano:preprod/,
    );
  });
});
