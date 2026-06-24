import { describe, expect, it } from "vitest";
import { preprod, PrivateKey } from "@evolution-sdk/evolution";
import { toFacilitatorCardanoSigner } from "../../src/signer";
import {
  CARDANO_MAINNET_CAIP2,
  CARDANO_PREPROD_CAIP2,
  CARDANO_PREPROD_CIP34,
} from "../../src/constants";

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

  it("treats a CIP-34 alias and its canonical id as the same configured network", async () => {
    // Configured with the CIP-34 form, queried with the canonical form: the
    // normalize layer must accept it (slot is derived from the chain config,
    // so no network call is made).
    const aliasConfigured = toFacilitatorCardanoSigner({
      network: CARDANO_PREPROD_CIP34,
      provider: { blockfrost: { baseUrl: "http://offline.invalid" } },
    });
    await expect(aliasConfigured.getCurrentSlot(CARDANO_PREPROD_CAIP2)).resolves.toBeGreaterThan(
      0n,
    );

    // The reverse direction: configured canonical, queried with the alias.
    await expect(makeSigner().getCurrentSlot(CARDANO_PREPROD_CIP34)).resolves.toBeGreaterThan(0n);
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

  it("exposes one address with a mnemonic and none when run provider-only", () => {
    const withWallet = makeSigner();
    expect(withWallet.getAddresses()).toHaveLength(1);
    expect(withWallet.getAddresses()[0]).toMatch(/^addr_test1/);

    // The facilitator only broadcasts the client's signed transaction, so the
    // mnemonic is optional; without it there is no address to expose.
    const providerOnly = toFacilitatorCardanoSigner({
      network: CARDANO_PREPROD_CAIP2,
      provider: { blockfrost: { baseUrl: "http://offline.invalid" } },
    });
    expect(providerOnly.getAddresses()).toEqual([]);
  });
});
