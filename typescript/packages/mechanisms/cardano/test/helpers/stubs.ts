/**
 * Shared deterministic test stubs for the Cardano integration and e2e suites.
 *
 * These drive the real client→facilitator scheme logic with REAL signed CBOR
 * transactions (via {@link buildSignedTx}) but an in-memory chain layer, so the
 * full flow runs without funds or network access.
 */
import {
  Address,
  Client,
  EnterpriseAddress,
  PlutusV3,
  preprod,
  PrivateKey,
  ScriptHash,
} from "@evolution-sdk/evolution";
import type { Network, PaymentRequirements } from "@x402/core/types";

import {
  ASSET_TRANSFER_METHOD_SCRIPT,
  CARDANO_PREPROD_CAIP2,
  LOVELACE_ASSET,
} from "../../src/constants";
import { buildScriptDatumInline } from "../../src/exact/script/datum";
import type { ClientCardanoSigner, FacilitatorCardanoSigner } from "../../src/signer";
import type { CardanoExtraScript } from "../../src/types";
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
      // Honor the script method's inline datum like the real signer does, so
      // full-flow script tests exercise datum attachment through the stack.
      const extra = input.extra as { assetTransferMethod?: string } | undefined;
      const scriptDatum =
        extra?.assetTransferMethod === ASSET_TRANSFER_METHOD_SCRIPT
          ? buildScriptDatumInline(extra as CardanoExtraScript)
          : undefined;
      const built = await buildSignedTx({
        payTo: input.payTo,
        asset: input.asset,
        amount: BigInt(input.amount),
        nonceUtxoRef: NONCE_REF,
        ttlSlot: TTL_SLOT,
        network: input.network,
        ...(scriptDatum ? { datum: scriptDatum } : {}),
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
 * @param extra - The requirements `extra` block (defaults to empty).
 * @returns The payment requirements.
 */
export function buildRequirements(
  payTo: string,
  amount: string,
  asset: string = LOVELACE_ASSET,
  extra: Record<string, unknown> = {},
): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK,
    asset,
    amount,
    payTo,
    maxTimeoutSeconds: 600,
    extra,
  };
}

/** Minimal always-succeeds Plutus V3 script (raw flat-encoded bytes). */
export const MINIMAL_PLUTUS_V3 = "4d01000033222220051200120011";

/**
 * Derives the enterprise script address + hash for a raw Plutus script, so
 * tests can target a real script address without a network call.
 *
 * @param code - Raw flat-encoded Plutus script hex.
 * @param networkId - 0 for testnets (default), 1 for mainnet.
 * @returns The bech32 script address and its lowercase script hash hex.
 */
export function scriptAddressFor(
  code: string,
  networkId = 0,
): { address: string; scriptHash: string } {
  const script = new PlutusV3.PlutusV3({ bytes: Uint8Array.from(Buffer.from(code, "hex")) });
  const hash = ScriptHash.fromScript(script);
  const enterprise = new EnterpriseAddress.EnterpriseAddress({
    networkId,
    paymentCredential: hash,
  });
  return {
    address: Address.toBech32(enterprise),
    scriptHash: ScriptHash.toHex(hash).toLowerCase(),
  };
}
