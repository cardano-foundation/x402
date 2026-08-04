import { Address, COSE, PrivateKey } from "@evolution-sdk/evolution";
import { addressFromSeed, keysFromSeed } from "@evolution-sdk/evolution/sdk/wallet/Derivation";
import type { PaymentRequirements } from "@x402/core/types";

import { ASSET_TRANSFER_METHOD_MASUMI, getCardanoNetworkId } from "../../constants";
import type {
  CardanoExtraMasumi,
  MasumiCommitmentPart,
  MasumiDeployment,
  MasumiInputCommitment,
  MasumiTerms,
} from "../../types";
import { masumiEscrowAddress, resolveMasumiDeployment } from "./blueprint";
import { MASUMI_PAYMENT_SOURCE_TYPE } from "./constants";
import {
  buildSignedTerms,
  commitmentPartDigest,
  computeInputHash,
  computeTermsDigest,
} from "./digests";
import { encodeBlockchainIdentifier } from "./identifier";
import { validateMasumiExtra } from "./schema";

/**
 * The requirements-issuer side of the Masumi method: builds a
 * `PaymentRequirements` whose `extra` carries a consistent request commitment,
 * seller-signed `terms`, CIP-8 authorization and compatibility identifier.
 *
 * The issuer MUST store the complete object and reuse it verbatim on the paid
 * retry — regenerating the nonce, deadlines, commitment or policies produces a
 * different `termsDigest` and invalidates the payment the buyer built.
 */

/** The seller's CIP-30 `signData` result, as the wire carries it. */
export interface MasumiSellerAuthorization {
  /** Complete CBOR `COSE_Key` as lowercase hex. */
  key: string;
  /** Complete CBOR `COSE_Sign1` as lowercase hex. */
  signature: string;
}

/**
 * Signs `termsDigest` on the seller's behalf. Wrap a CIP-30 wallet's
 * `signData(sellerAddress, lowercaseHex(termsDigest))` here, or use
 * {@link toMasumiSellerSigner} for a mnemonic-backed seller.
 */
export type MasumiTermsSigner = (
  sellerAddress: string,
  termsDigestHex: string,
) => MasumiSellerAuthorization | Promise<MasumiSellerAuthorization>;

/** One part of the request the issuer commits to. */
export interface MasumiCommitmentInput {
  /** Unique non-empty part name (conventionally `parameters`, `body`, `raw`). */
  name: string;
  /** How `content` becomes bytes. */
  canonicalization: "jcs" | "raw";
  /** Optional media type, preserved byte-for-byte. */
  mediaType?: string;
  /** RFC 8785-compatible JSON for `jcs`, unpadded base64url for `raw`. */
  content: unknown;
  /**
   * Whether to echo `content` on the wire. Set `false` for parts derived from
   * the client's own request bytes, which it recomputes from what it sent —
   * this keeps a large body out of the `PAYMENT-REQUIRED` header without
   * weakening the commitment, because the manifest excludes `content` anyway.
   * Defaults to `true`, which is REQUIRED for issuer-originated content.
   */
  echoContent?: boolean;
}

/** Everything needed to issue one Masumi 402. */
export interface IssueMasumiRequirementsInput {
  /** The x402 Cardano network identifier. */
  network: string;
  /** `lovelace` or a canonical `policyId.assetNameHex` unit. */
  asset: string;
  /** Positive canonical decimal string in the asset's smallest unit. */
  amount: string;
  maxTimeoutSeconds: number;
  /** The seller's key-credential address on the selected network. */
  sellerAddress: string;
  /** Produces the seller's CIP-8 authorization over `termsDigest`. */
  signTerms: MasumiTermsSigner;
  /** The ordered request commitment parts. */
  commitment: MasumiCommitmentInput[];
  /** POSIX-millisecond deadlines, ordered and clearing the spec's minimums. */
  payByTime: string;
  submitResultTime: string;
  unlockTime: string;
  externalDisputeUnlockTime: string;
  /**
   * 32 fresh cryptographically random bytes as 64 lowercase hex characters. A
   * fresh nonce MUST be generated for every new requirements object; one is
   * generated here when omitted.
   */
  sellerNonce?: string;
  /** Empty, or the buyer nonce extracted from the protected request. */
  buyerNonce?: string;
  /** Registry asset identifier; omitted, `null` or empty means unregistered. */
  agentIdentifier?: string | null;
  /** Optional key-credential payout address for the seller. */
  sellerReturnAddress?: string;
  settlementPolicy?: MasumiTerms["settlementPolicy"];
  submissionPolicy?: CardanoExtraMasumi["submissionPolicy"];
  confirmationPolicy?: CardanoExtraMasumi["confirmationPolicy"];
  /** Non-canonical validator parameters. Required on Preview. */
  deployment?: MasumiDeployment;
}

/**
 * Generates a lowercase hex string of cryptographically random bytes.
 *
 * @param bytes - How many bytes to generate.
 * @returns The lowercase hex encoding.
 */
function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);
  return Array.from(buffer, b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Issues a Masumi `PaymentRequirements`.
 *
 * `payTo` is derived from the deployment parameters, never supplied: the
 * verifier re-derives the same address and rejects a mismatch.
 *
 * @param input - What to issue.
 * @returns The complete payment requirements.
 * @throws When the resulting `extra` would not satisfy the wire schema.
 */
export async function issueMasumiRequirements(
  input: IssueMasumiRequirementsInput,
): Promise<PaymentRequirements> {
  const deployment = resolveMasumiDeployment(input.network, input.deployment);
  if (!deployment) {
    throw new Error(
      `Network ${input.network} has no canonical Masumi deployment; supply extra.deployment`,
    );
  }
  const payTo = masumiEscrowAddress(input.network, deployment);

  const parts: MasumiCommitmentPart[] = input.commitment.map(part => ({
    name: part.name,
    canonicalization: part.canonicalization,
    ...(part.mediaType !== undefined ? { mediaType: part.mediaType } : {}),
    ...(part.echoContent === false ? {} : { content: part.content }),
    digest: commitmentPartDigest(part),
  }));
  const inputCommitment: MasumiInputCommitment = {
    version: "1",
    algorithm: "sha256",
    parts,
    digest: "",
  };
  inputCommitment.digest = computeInputHash(inputCommitment);

  const terms: MasumiTerms = {
    version: "1",
    paymentType: MASUMI_PAYMENT_SOURCE_TYPE,
    sellerAddress: input.sellerAddress,
    ...(input.sellerReturnAddress !== undefined
      ? { sellerReturnAddress: input.sellerReturnAddress }
      : {}),
    sellerNonce: input.sellerNonce ?? randomHex(32),
    buyerNonce: input.buyerNonce ?? "",
    ...(input.agentIdentifier !== undefined ? { agentIdentifier: input.agentIdentifier } : {}),
    inputHash: inputCommitment.digest,
    payByTime: input.payByTime,
    submitResultTime: input.submitResultTime,
    unlockTime: input.unlockTime,
    externalDisputeUnlockTime: input.externalDisputeUnlockTime,
    settlementPolicy: input.settlementPolicy ?? "l1",
  };

  const requirements: PaymentRequirements = {
    scheme: "exact",
    network: input.network as PaymentRequirements["network"],
    asset: input.asset,
    amount: input.amount,
    payTo,
    maxTimeoutSeconds: input.maxTimeoutSeconds,
    extra: {},
  };

  // The digest covers `terms` plus the seven projected top-level fields, so it
  // can only be computed once the requirements above are fixed.
  const termsDigest = computeTermsDigest(
    buildSignedTerms(
      {
        assetTransferMethod: ASSET_TRANSFER_METHOD_MASUMI,
        inputCommitment,
        terms,
        referenceKey: "",
        referenceSignature: "",
        blockchainIdentifier: "",
      },
      requirements,
    ),
  );
  const authorization = await input.signTerms(input.sellerAddress, termsDigest);
  const referenceKey = authorization.key.toLowerCase();
  const referenceSignature = authorization.signature.toLowerCase();

  const extra: CardanoExtraMasumi = {
    assetTransferMethod: ASSET_TRANSFER_METHOD_MASUMI,
    ...(input.submissionPolicy !== undefined ? { submissionPolicy: input.submissionPolicy } : {}),
    ...(input.confirmationPolicy !== undefined
      ? { confirmationPolicy: input.confirmationPolicy }
      : {}),
    inputCommitment,
    terms,
    referenceKey,
    referenceSignature,
    blockchainIdentifier: encodeBlockchainIdentifier({
      sellerNonce: terms.sellerNonce,
      agentIdentifier: typeof terms.agentIdentifier === "string" ? terms.agentIdentifier : "",
      buyerNonce: terms.buyerNonce,
      referenceSignature,
      referenceKey,
      contractAddress: payTo,
    }),
    ...(input.deployment ? { deployment: input.deployment } : {}),
  };

  // Fail here rather than serving a 402 no client or facilitator will accept.
  const schema = validateMasumiExtra(extra, input.network);
  if (!schema.ok) {
    throw new Error(`Issued Masumi requirements are invalid: ${schema.detail}`);
  }

  requirements.extra = extra as unknown as Record<string, unknown>;
  return requirements;
}

/**
 * Builds a mnemonic-backed seller: its key-credential address and a
 * {@link MasumiTermsSigner} that produces the CIP-8 authorization with the same
 * key. Convenience for a resource server that holds the selling wallet directly;
 * a CIP-30 wallet integration supplies its own signer instead.
 *
 * @param config - The seller wallet configuration.
 * @param config.mnemonic - BIP-39 mnemonic of the selling wallet.
 * @param config.network - The x402 Cardano network identifier.
 * @param config.accountIndex - Optional derivation account index.
 * @returns The seller address and its terms signer.
 */
export function toMasumiSellerSigner(config: {
  mnemonic: string;
  network: string;
  accountIndex?: number;
}): { sellerAddress: string; signTerms: MasumiTermsSigner } {
  const mnemonic = config.mnemonic.trim().replace(/\s+/g, " ").toLowerCase();
  const derivation = {
    accountIndex: config.accountIndex,
    networkId: getCardanoNetworkId(config.network),
  };
  const privateKey = PrivateKey.fromBech32(keysFromSeed(mnemonic, derivation).paymentKey);
  const sellerAddress = Address.toBech32(addressFromSeed(mnemonic, derivation).address);

  return {
    sellerAddress,
    signTerms: (address, termsDigestHex) => {
      const signed = COSE.SignData.signData(
        Address.toHex(Address.fromBech32(address)),
        Uint8Array.from(Buffer.from(termsDigestHex, "hex")),
        privateKey,
      );
      return {
        key: Buffer.from(signed.key).toString("hex").toLowerCase(),
        signature: Buffer.from(signed.signature).toString("hex").toLowerCase(),
      };
    },
  };
}
