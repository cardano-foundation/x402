/**
 * Shared deterministic test stubs for the Cardano integration and e2e suites.
 *
 * These drive the real client→facilitator scheme logic with REAL signed CBOR
 * transactions (via {@link buildSignedTx}) but an in-memory chain layer, so the
 * full flow runs without funds or network access.
 */
import { Address, Client, preprod, PrivateKey } from "@evolution-sdk/evolution";
import type { Network, PaymentRequirements } from "@x402/core/types";

import { CARDANO_PREPROD_CAIP2, LOVELACE_ASSET } from "../../src/constants";
import type { ClientCardanoSigner, FacilitatorCardanoSigner } from "../../src/signer";
import { buildSignedTx } from "./buildSignedTx";

/** Network used across the deterministic suites. */
export const NETWORK: Network = CARDANO_PREPROD_CAIP2;

/** TTL slot comfortably ahead of {@link STUB_CURRENT_SLOT}. */
export const TTL_SLOT = 200_000_000n;

/** Current slot reported by the stub chain layer (below {@link TTL_SLOT}). */
export const STUB_CURRENT_SLOT = 100_000_000n;

/** Fixed nonce UTXO reference forced into every fixture transaction. */
export const NONCE_REF = `${"a".repeat(64)}#0`;

/** Address the stub chain layer reports as the nonce UTXO owner (the payer). */
export const PAYER_ADDRESS = "addr_test1vpfacilitatorpayerplaceholder";

/**
 * Mints a fresh, valid bech32 preprod address offline (no provider, no funds).
 *
 * @returns A bech32 `addr_test1...` address.
 */
export async function freshPreprodAddress(): Promise<string> {
  const client = Client.make(preprod).withSeed({ mnemonic: PrivateKey.generateMnemonic() });
  return Address.toBech32(await client.address());
}

/**
 * In-memory facilitator chain layer. Reports the nonce UTXO as unspent, a
 * current slot below the fixture TTL, and confirmed submission. Intentionally
 * omits `evaluateTransaction` so verify() does not attempt a node dry-run.
 *
 * @param overrides - Per-test overrides (e.g. spent nonce, advanced slot).
 * @returns A facilitator signer stub.
 */
export function stubFacilitatorSigner(
  overrides: Partial<FacilitatorCardanoSigner> = {},
): FacilitatorCardanoSigner {
  return {
    getAddresses: () => [PAYER_ADDRESS],
    getUtxo: async () => ({ exists: true, address: PAYER_ADDRESS }),
    getCurrentSlot: async () => STUB_CURRENT_SLOT,
    submitTransaction: async () => ({ txHash: "f".repeat(64), status: "confirmed" }),
    ...overrides,
  };
}

/**
 * Client signer stub that produces a real signed CBOR transaction offline via
 * {@link buildSignedTx}, so the full client→server→facilitator flow runs
 * without funds or network.
 *
 * @returns A client signer stub.
 */
export function stubClientSigner(): ClientCardanoSigner {
  return {
    getAddress: () => PAYER_ADDRESS,
    buildAndSignPaymentTransaction: async input => {
      const built = await buildSignedTx({
        payTo: input.payTo,
        asset: input.asset,
        amount: BigInt(input.amount),
        nonceUtxoRef: NONCE_REF,
        ttlSlot: TTL_SLOT,
        network: input.network,
      });
      return { transaction: built.transaction, nonce: built.nonce };
    },
  };
}

/**
 * Builds Cardano payment requirements for the deterministic suites.
 *
 * @param payTo - The recipient bech32 address.
 * @param amount - The amount in the asset's smallest unit.
 * @param asset - The asset unit (defaults to lovelace).
 * @returns The payment requirements.
 */
export function buildRequirements(
  payTo: string,
  amount: string,
  asset: string = LOVELACE_ASSET,
): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK,
    asset,
    amount,
    payTo,
    maxTimeoutSeconds: 600,
    extra: {},
  };
}
