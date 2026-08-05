import express from "express";
import { paymentMiddleware, setSettlementOverrides } from "@x402/express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { ExactAvmScheme } from "@x402/avm/exact/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { UptoEvmScheme } from "@x402/evm/upto/server";
import { BatchSettlementEvmScheme } from "@x402/evm/batch-settlement/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { ExactAptosScheme } from "@x402/aptos/exact/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { KEETA_TESTNET_CAIP2 } from "@x402/keeta";
import { ExactKeetaScheme } from "@x402/keeta/exact/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { ExactCardanoScheme } from "@x402/cardano/exact/server";
import { issueMasumiRequirements, toMasumiSellerSigner } from "@x402/cardano";
import { ExactTvmScheme } from "@x402/tvm/exact/server";
import { ExactNearScheme } from "@x402/near/exact/server";
import type { XrplAssetTransferMethod } from "@x402/xrpl";
import { ExactXrplScheme } from "@x402/xrpl/exact/server";
import { ExactConcordiumScheme } from "@x402/concordium/exact/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import {
  declareEip2612GasSponsoringExtension,
  declareErc20ApprovalGasSponsoringExtension,
} from "@x402/extensions";
import dotenv from "dotenv";
import { privateKeyToAccount } from "viem/accounts";

dotenv.config();

/**
 * Express E2E Test Server with x402 Payment Middleware
 *
 * This server demonstrates how to integrate x402 payment middleware
 * with an Express application for end-to-end testing.
 */

const PORT = process.env.PORT || "4021";
const AVM_NETWORK = (process.env.AVM_NETWORK ||
  "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe") as `${string}:${string}`;
const EVM_NETWORK = (process.env.EVM_NETWORK || "eip155:84532") as `${string}:${string}`;
const SVM_NETWORK = (process.env.SVM_NETWORK ||
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1") as `${string}:${string}`;
const APTOS_NETWORK = (process.env.APTOS_NETWORK || "aptos:2") as `${string}:${string}`;
const HEDERA_NETWORK = (process.env.HEDERA_NETWORK || "hedera:testnet") as `${string}:${string}`;
const KEETA_NETWORK = (process.env.KEETA_NETWORK || KEETA_TESTNET_CAIP2) as `${string}:${string}`;
const STELLAR_NETWORK = (process.env.STELLAR_NETWORK || "stellar:testnet") as `${string}:${string}`;
const CARDANO_NETWORK = (process.env.CARDANO_NETWORK || "cardano:preprod") as `${string}:${string}`;
const TVM_NETWORK = (process.env.TVM_NETWORK || "tvm:-3") as `${string}:${string}`;
const CCD_NETWORK = (process.env.CCD_NETWORK || "ccd:4221332d34e1694168c2a0c0b3fd0f27") as `${string}:${string}`;
const CCD_PAYEE_ADDRESS = process.env.CCD_PAYEE_ADDRESS as string | undefined;
const CCD_WEATHER_PRICE_MICRO_CCD = "1000";
const EVM_PAYEE_ADDRESS = process.env.EVM_PAYEE_ADDRESS as `0x${string}`;
const SVM_PAYEE_ADDRESS = process.env.SVM_PAYEE_ADDRESS as string;
const EVM_PERMIT2_ASSET = process.env.EVM_PERMIT2_ASSET as `0x${string}`;
const AVM_PAYEE_ADDRESS = process.env.AVM_PAYEE_ADDRESS as string;
const APTOS_PAYEE_ADDRESS = process.env.APTOS_PAYEE_ADDRESS as string;
const HEDERA_PAYEE_ADDRESS = process.env.HEDERA_PAYEE_ADDRESS as string | undefined;
const KEETA_PAYEE_ADDRESS = process.env.KEETA_PAYEE_ADDRESS as string | undefined;
const STELLAR_PAYEE_ADDRESS = process.env.STELLAR_PAYEE_ADDRESS as string | undefined;
const CARDANO_PAYEE_ADDRESS = process.env.CARDANO_PAYEE_ADDRESS as string | undefined;
// Asset the Cardano endpoints charge in. Defaults to lovelace (tADA) so the e2e
// is faucet-fundable; set CARDANO_ASSET to a `policyId.assetNameHex` unit (e.g.
// getDefaultUsdmAsset(CARDANO_NETWORK)) to run the same methods against a native
// token. CARDANO_AMOUNT is in the asset's smallest unit and must clear the
// masumi escrow's min-UTXO when paying lovelace.
const CARDANO_ASSET = process.env.CARDANO_ASSET || "lovelace";
const CARDANO_AMOUNT = process.env.CARDANO_AMOUNT || "5000000";
// Script (assetTransferMethod=script) fixture: a minimal always-succeeds Plutus
// V3 validator and its enterprise (preprod/preview) script address. The
// facilitator reconstructs this address from the script in `extra` and verifies
// it equals payTo (see the cardano package's scriptAddress tests for derivation).
const CARDANO_SCRIPT_CODE = "4d01000033222220051200120011";
const CARDANO_SCRIPT_ADDRESS = "addr_test1wp8l7eylksmjas7ypzm0q35dwnjdxxvsfn0z0lflqzgs55stpd682";
// Shared bazaar discovery extension reused by the Cardano method endpoints.
const CARDANO_DISCOVERY = declareDiscoveryExtension({
  output: {
    example: {
      message: "Protected Cardano endpoint accessed successfully",
      timestamp: "2024-01-01T00:00:00Z",
    },
    schema: {
      properties: {
        message: { type: "string" },
        timestamp: { type: "string" },
      },
      required: ["message", "timestamp"],
    },
  },
});
// How long a Cardano payment stays valid. The Masumi client anchors the tx TTL
// to pay_by_time, and the facilitator refuses a TTL further ahead than
// maxTimeoutSeconds, so pay_by_time cannot exceed issuance + this value.
const CARDANO_MAX_TIMEOUT_SECONDS = 600;
// Canonical block inclusion is the bar for the e2e: the spec default of 1 would
// make every Cardano scenario wait an extra ~20s block for no added signal.
const CARDANO_CONFIRMATION_POLICY = { l1Confirmations: 0 };
// The seller signs the Masumi terms with its selling wallet. The escrow pays
// this address, so a real deployment MUST set CARDANO_SELLER_MNEMONIC; the
// well-known test phrase below only keeps the e2e endpoint self-contained. The
// key needs no funds — it only authorizes the terms.
const CARDANO_TEST_SELLER_MNEMONIC =
  "test test test test test test test test test test test junk";
const CARDANO_SELLER = CARDANO_PAYEE_ADDRESS
  ? toMasumiSellerSigner({
      mnemonic: process.env.CARDANO_SELLER_MNEMONIC || CARDANO_TEST_SELLER_MNEMONIC,
      network: CARDANO_NETWORK,
    })
  : undefined;
/**
 * Issues one Masumi offer. A spec-conformant Masumi 402 carries a request
 * commitment and a seller signature over termsDigest, so it must be issued
 * rather than hand-written, and each issuance draws a fresh sellerNonce.
 *
 * The lock deadlines clear the spec's minimum intervals: pay_by + 5min <=
 * submit_result, submit_result + 15min <= unlock, unlock + 15min <= dispute.
 *
 * @returns The issued requirements: payTo (the escrow address), the price, and
 *   the `extra` block carrying the commitment, terms and authorization.
 */
const issueCardanoMasumiOffer = async () => {
  const payByMs = Date.now() + CARDANO_MAX_TIMEOUT_SECONDS * 1000;
  return issueMasumiRequirements({
    network: CARDANO_NETWORK,
    asset: CARDANO_ASSET,
    amount: CARDANO_AMOUNT,
    maxTimeoutSeconds: CARDANO_MAX_TIMEOUT_SECONDS,
    sellerAddress: CARDANO_SELLER!.sellerAddress,
    signTerms: CARDANO_SELLER!.signTerms,
    commitment: [
      {
        name: "parameters",
        canonicalization: "jcs",
        mediaType: "application/json",
        content: { endpoint: "/exact/cardano/masumi" },
      },
    ],
    payByTime: payByMs.toString(),
    submitResultTime: (payByMs + 5 * 60_000).toString(),
    unlockTime: (payByMs + 20 * 60_000).toString(),
    externalDisputeUnlockTime: (payByMs + 35 * 60_000).toString(),
    settlementPolicy: "l1",
    confirmationPolicy: CARDANO_CONFIRMATION_POLICY,
  });
};
// The offer currently on the wire. termsDigest binds to exactly one settled
// transaction, so an offer is one-shot: a second payer under the same terms is
// a replay the facilitator refuses. Re-issued per unpaid request below.
let CARDANO_MASUMI_REQUIREMENTS = CARDANO_SELLER ? await issueCardanoMasumiOffer() : undefined;
const TVM_PAYEE_ADDRESS = process.env.TVM_PAYEE_ADDRESS as string | undefined;
const NEAR_NETWORK = (process.env.NEAR_NETWORK || "near:testnet") as `${string}:${string}`;
const NEAR_PAYEE_ADDRESS = process.env.NEAR_PAYEE_ADDRESS as string | undefined;
const NEAR_ASSET = process.env.NEAR_ASSET as string | undefined;
const NEAR_AMOUNT = process.env.NEAR_AMOUNT as string | undefined;
const XRPL_NETWORK = (process.env.XRPL_NETWORK || "xrpl:1") as `${string}:${string}`;
const XRPL_PAYEE_ADDRESS = process.env.XRPL_PAYEE_ADDRESS as string | undefined;
const XRPL_ASSET = process.env.XRPL_ASSET as string | undefined;
const XRPL_AMOUNT = process.env.XRPL_AMOUNT as string | undefined;
const XRPL_ISSUER = process.env.XRPL_ISSUER as string | undefined;
const HEDERA_ASSET = process.env.HEDERA_ASSET ?? "0.0.0"; // 0.0.0 = HBAR or 0.0.429274 for USDC testnet
const HEDERA_AMOUNT = process.env.HEDERA_AMOUNT ?? "100000"; // price in smallest units (tinybars or token decimals), defaults to 0.001 HBAR or 0.1 USDC
const facilitatorUrl = process.env.FACILITATOR_URL;

const xrplPaymentConfig = (payTo: string, assetTransferMethod: XrplAssetTransferMethod) => ({
  accepts: {
    payTo,
    scheme: "exact" as const,
    price: {
      amount: XRPL_AMOUNT || "1000",
      asset: XRPL_ASSET || "XRP",
      extra: {
        assetTransferMethod,
        ...(XRPL_ASSET && XRPL_ASSET !== "XRP" && XRPL_ISSUER ? { issuer: XRPL_ISSUER } : {}),
      },
    },
    network: XRPL_NETWORK,
  },
});

if (!EVM_PAYEE_ADDRESS) {
  console.error("❌ EVM_PAYEE_ADDRESS environment variable is required");
  process.exit(1);
}

if (!SVM_PAYEE_ADDRESS) {
  console.error("❌ SVM_PAYEE_ADDRESS environment variable is required");
  process.exit(1);
}

if (!facilitatorUrl) {
  console.error("❌ FACILITATOR_URL environment variable is required");
  process.exit(1);
}

// Initialize Express app
const app = express();

// Create facilitator clients (mock facilitator as fallback for startup validation)
// Cardano settles on ~20-second blocks, so its `settle()` cannot finish inside
// the 30s facilitator-client default. Raising the ceiling costs nothing on the
// fast chains — they still return as soon as they are done.
const FACILITATOR_TIMEOUT_MS = 180_000;
const facilitatorClients = [
  new HTTPFacilitatorClient({ url: facilitatorUrl, timeoutMs: FACILITATOR_TIMEOUT_MS }),
];
const mockFacilitatorUrl = process.env.MOCK_FACILITATOR_URL;
if (mockFacilitatorUrl) {
  facilitatorClients.push(
    new HTTPFacilitatorClient({ url: mockFacilitatorUrl, timeoutMs: FACILITATOR_TIMEOUT_MS }),
  );
}

// Create x402 resource server
const server = new x402ResourceServer(facilitatorClients);

// Register server schemes
if (AVM_PAYEE_ADDRESS) {
  server.register("algorand:*", new ExactAvmScheme());
}
if (CCD_PAYEE_ADDRESS) {
  server.register("ccd:*", new ExactConcordiumScheme());
}
server.register("eip155:*", new ExactEvmScheme());
server.register("eip155:*", new UptoEvmScheme());

// Register batch-settlement scheme for the EVM payee.
// e2e flow does NOT use ChannelManager — settle actions are handled inline.
const receiverAuthorizerPrivateKey = process.env.EVM_RECEIVER_AUTHORIZER_PRIVATE_KEY as
  | `0x${string}`
  | undefined;
const receiverAuthorizerSigner = receiverAuthorizerPrivateKey
  ? privateKeyToAccount(receiverAuthorizerPrivateKey)
  : undefined;
server.register(
  "eip155:*",
  new BatchSettlementEvmScheme(EVM_PAYEE_ADDRESS, {
    ...(receiverAuthorizerSigner ? { receiverAuthorizerSigner } : {}),
  }),
);
server.register("solana:*", new ExactSvmScheme());
if (APTOS_PAYEE_ADDRESS) {
  server.register("aptos:*", new ExactAptosScheme());
}
if (HEDERA_PAYEE_ADDRESS) {
  server.register("hedera:*", new ExactHederaScheme());
}
if (KEETA_PAYEE_ADDRESS) {
  server.register("keeta:*", new ExactKeetaScheme());
}
if (STELLAR_PAYEE_ADDRESS) {
  server.register("stellar:*", new ExactStellarScheme());
}
if (CARDANO_PAYEE_ADDRESS) {
  server.register("cardano:*", new ExactCardanoScheme());
}
if (TVM_PAYEE_ADDRESS) {
  server.register("tvm:*", new ExactTvmScheme());
}
if (NEAR_PAYEE_ADDRESS) {
  server.register("near:*", new ExactNearScheme());
}
if (XRPL_PAYEE_ADDRESS) {
  server.register("xrpl:*", new ExactXrplScheme());
}

// Register Bazaar discovery extension
server.registerExtension(bazaarResourceServerExtension);

console.log(
  `Facilitator account: ${process.env.EVM_PRIVATE_KEY ? process.env.EVM_PRIVATE_KEY.substring(0, 10) + "..." : "not configured"}`,
);
console.log(`Using remote facilitator at: ${facilitatorUrl}`);

/**
 * Pre-middleware guard for optional AVM endpoint
 * Returns 501 Not Implemented if AVM is not configured
 */
app.get("/exact/avm", (req, res, next) => {
  if (!AVM_PAYEE_ADDRESS) {
    return res.status(501).json({
      error: "AVM payments not configured",
      message: "AVM_PAYEE_ADDRESS environment variable is not set",
    });
  }
  next();
});

/**
 * Pre-middleware guard for optional Aptos endpoint
 * Returns 501 Not Implemented if Aptos is not configured
 */
app.get("/exact/aptos", (req, res, next) => {
  if (!APTOS_PAYEE_ADDRESS) {
    return res.status(501).json({
      error: "Aptos payments not configured",
      message: "APTOS_PAYEE_ADDRESS environment variable is not set",
    });
  }
  next();
});

/**
 * Pre-middleware guard for optional Hedera endpoint
 * Returns 501 Not Implemented if Hedera is not configured
 */
app.get("/exact/hedera", (req, res, next) => {
  if (!HEDERA_PAYEE_ADDRESS) {
    return res.status(501).json({
      error: "Hedera payments not configured",
      message: "HEDERA_PAYEE_ADDRESS environment variable is not set",
    });
  }
  next();
});

/**
 * Pre- middleware guard for optional Keeta endpoint
 * Returns 501 Not Implemented if Keeta is not configured
 */
app.get("/exact/keeta", (req, res, next) => {
  if (!KEETA_PAYEE_ADDRESS) {
    return res.status(501).json({
      error: "Keeta payments not configured",
      message: "KEETA_PAYEE_ADDRESS environment variable is not set",
    });
  }
  next();
});

/**
 * Pre-middleware guard for optional Concordium endpoint
 * Returns 501 Not Implemented if Concordium is not configured
 */
app.get("/exact/ccd", (req, res, next) => {
  if (!CCD_PAYEE_ADDRESS) {
    return res.status(501).json({
      error: "Concordium payments not configured",
      message: "CCD_PAYEE_ADDRESS environment variable is not set",
    });
  }
  next();
});

/**
 * Pre-middleware guard for optional Stellar endpoint
 * Returns 501 Not Implemented if Stellar is not configured
 */
app.use("/exact/stellar", (req, res, next) => {
  if (!STELLAR_PAYEE_ADDRESS) {
    return res.status(501).json({
      error: "Stellar payments not configured",
      message: "STELLAR_PAYEE_ADDRESS environment variable is not set",
    });
  }
  next();
});

/**
 * Pre-middleware guard for optional Cardano endpoint
 * Returns 501 Not Implemented if Cardano is not configured
 */
app.use("/exact/cardano", (req, res, next) => {
  if (!CARDANO_PAYEE_ADDRESS) {
    return res.status(501).json({
      error: "Cardano payments not configured",
      message: "CARDANO_PAYEE_ADDRESS environment variable is not set",
    });
  }
  next();
});

/**
 * Re-issues the Masumi offer ahead of each unpaid request, so two clients
 * hitting this endpoint never share a termsDigest. A request carrying
 * PAYMENT-SIGNATURE is the paid retry of an offer the client was already
 * quoted and must be matched against that same offer, so it is left alone.
 */
app.use("/exact/cardano/masumi", async (req, _res, next) => {
  if (CARDANO_SELLER && !req.headers["payment-signature"]) {
    CARDANO_MASUMI_REQUIREMENTS = await issueCardanoMasumiOffer();
  }
  next();
});

/**
 * Pre-middleware guard for optional TVM endpoint
 * Returns 501 Not Implemented if TVM is not configured
 */
app.use("/exact/tvm", (req, res, next) => {
  if (!TVM_PAYEE_ADDRESS) {
    return res.status(501).json({
      error: "TVM payments not configured",
      message: "TVM_PAYEE_ADDRESS environment variable is not set",
    });
  }
  next();
});

/**
 * Configure x402 payment middleware using builder pattern
 *
 * This middleware protects endpoints with $0.001 USDC payment requirements
 * on Base Sepolia, Solana Devnet, Aptos Testnet, and Stellar Testnet with bazaar discovery extension.
 */
app.use(
  paymentMiddleware(
    {
      // Route-specific payment configuration
      ...(AVM_PAYEE_ADDRESS
        ? {
          "GET /exact/avm": {
            accepts: {
              payTo: AVM_PAYEE_ADDRESS,
              scheme: "exact",
              price: "$0.001",
              network: AVM_NETWORK,
            },
            extensions: {
              ...declareDiscoveryExtension({
                output: {
                  example: {
                    message: "Protected endpoint accessed successfully",
                    timestamp: "2024-01-01T00:00:00Z",
                  },
                  schema: {
                    properties: {
                      message: { type: "string" },
                      timestamp: { type: "string" },
                    },
                    required: ["message", "timestamp"],
                  },
                },
              }),
            },
          },
        }
        : {}),
      ...(CCD_PAYEE_ADDRESS
        ? {
            "GET /exact/ccd": {
              accepts: {
                payTo: CCD_PAYEE_ADDRESS,
                scheme: "exact",
                price: {
                  amount: CCD_WEATHER_PRICE_MICRO_CCD,
                  asset: "CCD",
                },
                network: CCD_NETWORK,
              },
              extensions: {
                ...declareDiscoveryExtension({
                  output: {
                    example: {
                      message: "Protected endpoint accessed successfully",
                      timestamp: "2024-01-01T00:00:00Z",
                    },
                    schema: {
                      properties: {
                        message: { type: "string" },
                        timestamp: { type: "string" },
                      },
                      required: ["message", "timestamp"],
                    },
                  },
                }),
              },
            },
          }
        : {}),
      "GET /batch-settlement/evm/eip3009": {
        accepts: {
          payTo: EVM_PAYEE_ADDRESS,
          scheme: "batch-settlement",
          price: "$0.001",
          network: EVM_NETWORK,
        },
      },
      "GET /batch-settlement/evm/permit2": {
        accepts: {
          payTo: EVM_PAYEE_ADDRESS,
          scheme: "batch-settlement",
          network: EVM_NETWORK,
          price: {
            amount: "1000",
            asset: EVM_PERMIT2_ASSET,
            extra: {
              assetTransferMethod: "permit2",
              name: EVM_NETWORK == "eip155:84532" ? "USDC" : "USD Coin",
              version: "2",
            },
          },
        },
      },
      "GET /batch-settlement/evm/permit2-eip2612GasSponsoring": {
        accepts: {
          payTo: EVM_PAYEE_ADDRESS,
          scheme: "batch-settlement",
          network: EVM_NETWORK,
          price: "$0.001",
          extra: { assetTransferMethod: "permit2" },
        },
        extensions: {
          ...declareEip2612GasSponsoringExtension(),
        },
      },
      "GET /batch-settlement/evm/permit2-erc20ApprovalGasSponsoring": {
        accepts: {
          payTo: EVM_PAYEE_ADDRESS,
          scheme: "batch-settlement",
          network: EVM_NETWORK,
          price: {
            amount: "1000",
            asset: EVM_PERMIT2_ASSET,
            extra: {
              assetTransferMethod: "permit2",
            },
          },
        },
        extensions: {
          ...declareErc20ApprovalGasSponsoringExtension(),
        },
      },
      "GET /exact/evm/eip3009": {
        accepts: {
          payTo: EVM_PAYEE_ADDRESS,
          scheme: "exact",
          price: "$0.001",
          network: EVM_NETWORK,
        },
        extensions: {
          ...declareDiscoveryExtension({
            output: {
              example: {
                message: "Protected endpoint accessed successfully",
                timestamp: "2024-01-01T00:00:00Z",
              },
              schema: {
                properties: {
                  message: { type: "string" },
                  timestamp: { type: "string" },
                },
                required: ["message", "timestamp"],
              },
            },
          }),
        },
      },
      "GET /exact/svm": {
        accepts: {
          payTo: SVM_PAYEE_ADDRESS,
          scheme: "exact",
          price: "$0.001",
          network: SVM_NETWORK,
        },
        extensions: {
          ...declareDiscoveryExtension({
            output: {
              example: {
                message: "Protected endpoint accessed successfully",
                timestamp: "2024-01-01T00:00:00Z",
              },
              schema: {
                properties: {
                  message: { type: "string" },
                  timestamp: { type: "string" },
                },
                required: ["message", "timestamp"],
              },
            },
          }),
        },
      },
      ...(APTOS_PAYEE_ADDRESS
        ? {
          "GET /exact/aptos": {
            accepts: {
              payTo: APTOS_PAYEE_ADDRESS,
              scheme: "exact",
              price: "$0.001",
              network: APTOS_NETWORK,
            },
            extensions: {
              ...declareDiscoveryExtension({
                output: {
                  example: {
                    message: "Protected endpoint accessed successfully",
                    timestamp: "2024-01-01T00:00:00Z",
                  },
                  schema: {
                    properties: {
                      message: { type: "string" },
                      timestamp: { type: "string" },
                    },
                    required: ["message", "timestamp"],
                  },
                },
              }),
            },
          },
        }
        : {}),
      ...(HEDERA_PAYEE_ADDRESS
        ? {
          "GET /exact/hedera": {
            accepts: {
              payTo: HEDERA_PAYEE_ADDRESS,
              scheme: "exact",
              price: {
                amount: HEDERA_AMOUNT,
                asset: HEDERA_ASSET,
              },
              network: HEDERA_NETWORK,
            },
            extensions: {
              ...declareDiscoveryExtension({
                output: {
                  example: {
                    message: "Protected Hedera endpoint accessed successfully",
                    timestamp: "2024-01-01T00:00:00Z",
                  },
                  schema: {
                    properties: {
                      message: { type: "string" },
                      timestamp: { type: "string" },
                    },
                    required: ["message", "timestamp"],
                  },
                },
              }),
            },
          },
        }
        : {}),
      ...(KEETA_PAYEE_ADDRESS
        ? {
          "GET /exact/keeta": {
            accepts: {
              payTo: KEETA_PAYEE_ADDRESS,
              scheme: "exact",
              price: "$0.001",
              network: KEETA_NETWORK,
            },
            extensions: {
              ...declareDiscoveryExtension({
                output: {
                  example: {
                    message: "Protected Keeta endpoint accessed successfully",
                    timestamp: "2024-01-01T00:00:00Z",
                  },
                  schema: {
                    properties: {
                      message: { type: "string" },
                      timestamp: { type: "string" },
                    },
                    required: ["message", "timestamp"],
                  },
                },
              }),
            },
          },
        }
        : {}),
      // Permit2 endpoint for ERC-20 approval gas sponsoring (no EIP-2612)
      "GET /exact/evm/permit2-erc20ApprovalGasSponsoring": {
        accepts: {
          payTo: EVM_PAYEE_ADDRESS,
          scheme: "exact",
          network: EVM_NETWORK,
          price: {
            amount: "1000",
            asset: EVM_PERMIT2_ASSET,
            extra: {
              assetTransferMethod: "permit2",
            },
          },
        },
        extensions: {
          ...declareErc20ApprovalGasSponsoringExtension(),
        },
      },
      // Permit2 standard/direct endpoint - no gas sponsoring, client must pre-approve Permit2
      "GET /exact/evm/permit2": {
        accepts: {
          payTo: EVM_PAYEE_ADDRESS,
          scheme: "exact",
          network: EVM_NETWORK,
          price: {
            amount: "1000",
            asset: EVM_PERMIT2_ASSET,
            extra: {
              assetTransferMethod: "permit2",
              name: EVM_NETWORK == "eip155:84532" ? "USDC" : "USD Coin",
              version: "2",
            },
          },
        },
        extensions: {
          ...declareDiscoveryExtension({
            output: {
              example: {
                message: "Permit2 endpoint accessed successfully",
                timestamp: "2024-01-01T00:00:00Z",
                method: "permit2",
              },
              schema: {
                properties: {
                  message: { type: "string" },
                  timestamp: { type: "string" },
                  method: { type: "string" },
                },
                required: ["message", "timestamp", "method"],
              },
            },
          }),
        },
      },
      // Permit2 endpoint with EIP-2612 gas sponsoring
      "GET /exact/evm/permit2-eip2612GasSponsoring": {
        accepts: {
          payTo: EVM_PAYEE_ADDRESS,
          scheme: "exact",
          network: EVM_NETWORK,
          price: "$0.001",
          extra: { assetTransferMethod: "permit2" },
        },
        extensions: {
          ...declareDiscoveryExtension({
            output: {
              example: {
                message: "Permit2 EIP-2612 endpoint accessed successfully",
                timestamp: "2024-01-01T00:00:00Z",
                method: "permit2-eip2612",
              },
              schema: {
                properties: {
                  message: { type: "string" },
                  timestamp: { type: "string" },
                  method: { type: "string" },
                },
                required: ["message", "timestamp", "method"],
              },
            },
          }),
          ...declareEip2612GasSponsoringExtension(),
        },
      },
      // Upto Permit2 standard/direct endpoint - no gas sponsoring, client must pre-approve Permit2
      // Authorizes up to 2000 atomic units, settles 1000 (partial settlement)
      "GET /upto/evm/permit2": {
        accepts: {
          payTo: EVM_PAYEE_ADDRESS,
          scheme: "upto",
          network: EVM_NETWORK,
          price: {
            amount: "2000",
            asset: EVM_PERMIT2_ASSET,
            extra: {
              assetTransferMethod: "permit2",
              name: EVM_NETWORK == "eip155:84532" ? "USDC" : "USD Coin",
              version: "2",
            },
          },
        },
      },
      // Upto Permit2 endpoint with EIP-2612 gas sponsoring
      // Authorizes up to 2000 atomic units, settles 1000 (partial settlement)
      "GET /upto/evm/permit2-eip2612GasSponsoring": {
        accepts: {
          payTo: EVM_PAYEE_ADDRESS,
          scheme: "upto",
          network: EVM_NETWORK,
          price: {
            amount: "2000",
            asset: EVM_PERMIT2_ASSET,
            extra: {
              assetTransferMethod: "permit2",
              name: EVM_NETWORK == "eip155:84532" ? "USDC" : "USD Coin",
              version: "2",
            },
          },
        },
        extensions: {
          ...declareEip2612GasSponsoringExtension(),
        },
      },
      // Upto Permit2 endpoint for ERC-20 approval gas sponsoring (no EIP-2612)
      // Authorizes up to 2000 atomic units, settles 1000 (partial settlement)
      "GET /upto/evm/permit2-erc20ApprovalGasSponsoring": {
        accepts: {
          payTo: EVM_PAYEE_ADDRESS,
          scheme: "upto",
          network: EVM_NETWORK,
          price: {
            amount: "2000",
            asset: EVM_PERMIT2_ASSET,
            extra: {
              assetTransferMethod: "permit2",
            },
          },
        },
        extensions: {
          ...declareErc20ApprovalGasSponsoringExtension(),
        },
      },
      ...(STELLAR_PAYEE_ADDRESS
        ? {
          "GET /exact/stellar": {
            accepts: {
              payTo: STELLAR_PAYEE_ADDRESS!,
              scheme: "exact",
              price: "$0.001",
              network: STELLAR_NETWORK,
            },
            extensions: {
              ...declareDiscoveryExtension({
                output: {
                  example: {
                    message: "Protected Stellar endpoint accessed successfully",
                    timestamp: "2024-01-01T00:00:00Z",
                  },
                  schema: {
                    properties: {
                      message: { type: "string" },
                      timestamp: { type: "string" },
                    },
                    required: ["message", "timestamp"],
                  },
                },
              }),
            },
          },
        }
        : {}),
      ...(TVM_PAYEE_ADDRESS
        ? {
          "GET /exact/tvm": {
            accepts: {
              payTo: TVM_PAYEE_ADDRESS,
              scheme: "exact",
              price: "$0.001",
              network: TVM_NETWORK,
            },
            extensions: {
              ...declareDiscoveryExtension({
                output: {
                  example: {
                    message: "Protected TVM endpoint accessed successfully",
                    timestamp: "2024-01-01T00:00:00Z",
                  },
                  schema: {
                    properties: {
                      message: { type: "string" },
                      timestamp: { type: "string" },
                    },
                    required: ["message", "timestamp"],
                  },
                },
              }),
            },
          },
        }
        : {}),
      ...(CARDANO_PAYEE_ADDRESS
        ? {
          // One endpoint per Cardano assetTransferMethod. The asset is a config
          // axis (CARDANO_ASSET), not a separate endpoint, so the same three
          // methods run unchanged against tADA or a native token.
          "GET /exact/cardano/default": {
            accepts: {
              payTo: CARDANO_PAYEE_ADDRESS!,
              scheme: "exact",
              price: { amount: CARDANO_AMOUNT, asset: CARDANO_ASSET },
              network: CARDANO_NETWORK,
              extra: {
                assetTransferMethod: "default",
                confirmationPolicy: CARDANO_CONFIRMATION_POLICY,
              },
            },
            extensions: { ...CARDANO_DISCOVERY },
          },
          "GET /exact/cardano/masumi": {
            accepts: {
              // Locks into the vested_pay escrow (Web3CardanoV2). payTo is the
              // escrow script address the verifier re-derives from the
              // deployment parameters — it is never hand-supplied. For a
              // native-token lock the escrow output also carries structural
              // lovelace (min-UTXO + collateral) the client computes itself.
              payTo: CARDANO_MASUMI_REQUIREMENTS!.payTo,
              scheme: "exact",
              price: {
                amount: CARDANO_MASUMI_REQUIREMENTS!.amount,
                asset: CARDANO_MASUMI_REQUIREMENTS!.asset,
              },
              network: CARDANO_NETWORK,
              maxTimeoutSeconds: CARDANO_MAX_TIMEOUT_SECONDS,
              // Carries the request commitment, the seller-signed terms, the
              // CIP-8 authorization over termsDigest and the compatibility
              // identifier. A getter, because the middleware reads it per
              // request and the pre-middleware above rotates the offer between
              // 402s; the paid retry sees the same block it was quoted, since
              // regenerating it would change termsDigest.
              get extra() {
                return CARDANO_MASUMI_REQUIREMENTS!.extra;
              },
            },
            extensions: { ...CARDANO_DISCOVERY },
          },
          "GET /exact/cardano/script": {
            accepts: {
              // payTo is the script address the facilitator reconstructs from
              // the script descriptor below and verifies it matches.
              payTo: CARDANO_SCRIPT_ADDRESS,
              scheme: "exact",
              price: { amount: CARDANO_AMOUNT, asset: CARDANO_ASSET },
              network: CARDANO_NETWORK,
              extra: {
                assetTransferMethod: "script",
                confirmationPolicy: CARDANO_CONFIRMATION_POLICY,
                script: { type: "plutusV3", code: CARDANO_SCRIPT_CODE },
                // Optional inline datum (CBOR hex) attached to the payTo output.
                // A real contract declares whatever datum it needs; the client
                // attaches it verbatim and the facilitator does not verify it.
                // Here the always-succeeds validator ignores it — this only
                // demonstrates the wiring. `d8799f182aff` = Constr 0 [42].
                datum: "d8799f182aff",
              },
            },
            extensions: { ...CARDANO_DISCOVERY },
          },
        }
        : {}),
      ...(NEAR_PAYEE_ADDRESS
        ? {
            "GET /exact/near": {
              accepts: {
                payTo: NEAR_PAYEE_ADDRESS,
                scheme: "exact",
                price: {
                  amount: NEAR_AMOUNT || "1000000000000000000000",
                  asset: NEAR_ASSET || "wrap.testnet",
                },
                network: NEAR_NETWORK,
              },
            },
          }
        : {}),
      ...(XRPL_PAYEE_ADDRESS
        ? {
            "GET /exact/xrpl/sequence": xrplPaymentConfig(XRPL_PAYEE_ADDRESS, "sequence"),
            "GET /exact/xrpl/ticketSequence": xrplPaymentConfig(
              XRPL_PAYEE_ADDRESS,
              "ticketSequence",
            ),
          }
        : {}),
    },
    server, // Pass pre-configured server instance
  ),
);

/**
 * Protected AVM endpoint - requires payment to access
 *
 * This endpoint demonstrates a resource protected by x402 payment middleware for AVM.
 * Clients must provide a valid payment signature to access this endpoint.
 * Note: 501 check is handled by pre-middleware guard above.
 */
app.get("/exact/avm", (req, res) => {
  res.json({
    message: "Protected endpoint accessed successfully",
    timestamp: new Date().toISOString(),
  });
});

/**
 * Protected batch-settlement endpoint — exercised by repeated voucher requests
 * over a single payment channel followed by an optional cooperative refund.
 */
app.get("/batch-settlement/evm/eip3009", (req, res) => {
  res.json({
    message: "Batch-settlement endpoint accessed successfully",
    timestamp: new Date().toISOString(),
  });
});

app.get("/batch-settlement/evm/permit2", (req, res) => {
  res.json({
    message: "Batch-settlement Permit2 endpoint accessed successfully",
    timestamp: new Date().toISOString(),
    method: "batch-settlement-permit2",
  });
});

app.get("/batch-settlement/evm/permit2-eip2612GasSponsoring", (req, res) => {
  res.json({
    message: "Batch-settlement Permit2 EIP-2612 endpoint accessed successfully",
    timestamp: new Date().toISOString(),
    method: "batch-settlement-permit2-eip2612",
  });
});

app.get("/batch-settlement/evm/permit2-erc20ApprovalGasSponsoring", (req, res) => {
  res.json({
    message: "Batch-settlement Permit2 ERC-20 approval endpoint accessed successfully",
    timestamp: new Date().toISOString(),
    method: "batch-settlement-permit2-erc20-approval",
  });
});

/**
 * Protected endpoint - requires payment to access
 *
 * This endpoint demonstrates a resource protected by x402 payment middleware.
 * Clients must provide a valid payment signature to access this endpoint.
 */
app.get("/exact/evm/eip3009", (req, res) => {
  res.json({
    message: "Protected endpoint accessed successfully",
    timestamp: new Date().toISOString(),
  });
});

/**
 * Protected SVM endpoint - requires payment to access
 *
 * This endpoint demonstrates a resource protected by x402 payment middleware for SVM.
 * Clients must provide a valid payment signature to access this endpoint.
 */
app.get("/exact/svm", (req, res) => {
  res.json({
    message: "Protected endpoint accessed successfully",
    timestamp: new Date().toISOString(),
  });
});

/**
 * Protected Aptos endpoint - requires payment to access
 *
 * This endpoint demonstrates a resource protected by x402 payment middleware for Aptos.
 * Clients must provide a valid payment signature to access this endpoint.
 * Note: 501 check is handled by pre-middleware guard above.
 */
app.get("/exact/aptos", (req, res) => {
  res.json({
    message: "Protected endpoint accessed successfully",
    timestamp: new Date().toISOString(),
  });
});

/**
 * Protected Hedera endpoint - requires payment to access
 *
 * This endpoint demonstrates a resource protected by x402 payment middleware for Hedera.
 * Clients must provide a valid payment signature to access this endpoint.
 * Note: 501 check is handled by pre-middleware guard above.
 */
app.get("/exact/hedera", (req, res) => {
  res.json({
    message: "Protected Hedera endpoint accessed successfully",
    timestamp: new Date().toISOString(),
  });
});

/**
 * Protected Keeta endpoint - requires payment to access
 *
 * This endpoint demonstrates a resource protected by x402 payment middleware for Keeta.
 * Clients must provide a valid payment signature to access this endpoint.
 * Note: 501 check is handled by pre-middleware guard above.
 */
app.get("/exact/keeta", (req, res) => {
  res.json({
    message: "Protected Keeta endpoint accessed successfully",
    timestamp: new Date().toISOString(),
  });
});

/**
 * Protected Concordium endpoint - requires payment via Concordium exact scheme
 *
 * This endpoint demonstrates a resource protected by x402 payment middleware for Concordium.
 * Clients must provide a valid payment signature to access this endpoint.
 * Note: 501 check is handled by pre-middleware guard above.
 */
app.get("/exact/ccd", (req, res) => {
  res.json({
    message: "Protected Concordium endpoint accessed successfully",
    timestamp: new Date().toISOString(),
  });
});

/**
 * Protected Permit2 ERC-20 endpoint - requires payment via Permit2 flow with ERC-20 approval
 *
 * This endpoint demonstrates the ERC-20 approval gas sponsoring flow for tokens
 * that do NOT implement EIP-2612. The facilitator broadcasts the pre-signed
 * approve() transaction on the client's behalf before settling.
 */
app.get("/exact/evm/permit2-erc20ApprovalGasSponsoring", (req, res) => {
  res.json({
    message: "Permit2 ERC-20 approval endpoint accessed successfully",
    timestamp: new Date().toISOString(),
    method: "permit2-erc20-approval",
  });
});

/**
 * Protected Permit2 endpoint - requires payment via Permit2 flow
 *
 * This endpoint demonstrates the Permit2 payment flow.
 * Clients must have approved Permit2 to spend their USDC before accessing.
 */
app.get("/exact/evm/permit2", (req, res) => {
  res.json({
    message: "Permit2 endpoint accessed successfully",
    timestamp: new Date().toISOString(),
    method: "permit2",
  });
});

/**
 * Protected Permit2 EIP-2612 endpoint - requires payment via Permit2 with gas sponsoring
 *
 * Uses EIP-2612 permit atomically in settleWithPermit. No pre-approval needed.
 */
app.get("/exact/evm/permit2-eip2612GasSponsoring", (req, res) => {
  res.json({
    message: "Permit2 EIP-2612 endpoint accessed successfully",
    timestamp: new Date().toISOString(),
    method: "permit2-eip2612",
  });
});

app.get("/upto/evm/permit2", (req, res) => {
  setSettlementOverrides(res, { amount: "1000" });
  res.json({
    message: "Upto Permit2 endpoint accessed successfully",
    timestamp: new Date().toISOString(),
    method: "upto-permit2",
  });
});

app.get("/upto/evm/permit2-eip2612GasSponsoring", (req, res) => {
  setSettlementOverrides(res, { amount: "1000" });
  res.json({
    message: "Upto Permit2 EIP-2612 endpoint accessed successfully",
    timestamp: new Date().toISOString(),
    method: "upto-permit2-eip2612",
  });
});

app.get("/upto/evm/permit2-erc20ApprovalGasSponsoring", (req, res) => {
  setSettlementOverrides(res, { amount: "1000" });
  res.json({
    message: "Upto Permit2 ERC-20 approval endpoint accessed successfully",
    timestamp: new Date().toISOString(),
    method: "upto-permit2-erc20-approval",
  });
});

/**
 * Protected Stellar endpoint - requires payment to access
 *
 * This endpoint demonstrates a resource protected by x402 payment middleware for Stellar.
 * Clients must provide a valid payment signature to access this endpoint.
 * Note: 501 check is handled by pre-middleware guard above.
 */
if (STELLAR_PAYEE_ADDRESS) {
  app.get("/exact/stellar", (req, res) => {
    res.json({
      message: "Protected Stellar endpoint accessed successfully",
      timestamp: new Date().toISOString(),
    });
  });
}

/**
 * Protected Cardano endpoint - requires payment to access
 *
 * This endpoint demonstrates a resource protected by x402 payment middleware for Cardano.
 * Clients must provide a valid payment signature to access this endpoint.
 * Note: 501 check is handled by pre-middleware guard above.
 */
if (CARDANO_PAYEE_ADDRESS) {
  app.get(
    [
      "/exact/cardano/default",
      "/exact/cardano/masumi",
      "/exact/cardano/script",
    ],
    (req, res) => {
      res.json({
        message: "Protected Cardano endpoint accessed successfully",
        timestamp: new Date().toISOString(),
      });
    },
  );
}

/**
 * Protected TVM endpoint - requires payment to access
 *
 * This endpoint demonstrates a resource protected by x402 payment middleware for TVM.
 * Clients must provide a valid payment signature to access this endpoint.
 * Note: 501 check is handled by pre-middleware guard above.
 */
if (TVM_PAYEE_ADDRESS) {
  app.get("/exact/tvm", (req, res) => {
    res.json({
      message: "Protected TVM endpoint accessed successfully",
      timestamp: new Date().toISOString(),
    });
  });
}

if (NEAR_PAYEE_ADDRESS) {
  app.get("/exact/near", (req, res) => {
    res.json({
      message: "Protected NEAR endpoint accessed successfully",
      timestamp: new Date().toISOString(),
    });
  });
}

if (XRPL_PAYEE_ADDRESS) {
  for (const assetTransferMethod of ["sequence", "ticketSequence"] as const) {
    app.get(`/exact/xrpl/${assetTransferMethod}`, (req, res) => {
      res.json({
        message: "Protected XRPL endpoint accessed successfully",
        timestamp: new Date().toISOString(),
      });
    });
  }
}

/**
 * Health check endpoint - no payment required
 *
 * Used to verify the server is running and responsive.
 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    network: EVM_NETWORK,
    payee: EVM_PAYEE_ADDRESS,
    version: "2.0.0",
  });
});

/**
 * Shutdown endpoint - used by e2e tests
 *
 * Allows graceful shutdown of the server during testing.
 */
app.post("/close", (req, res) => {
  res.json({ message: "Server shutting down gracefully" });
  console.log("Received shutdown request");

  // Give time for response to be sent
  setTimeout(() => {
    process.exit(0);
  }, 100);
});

// Start the server
app.listen(parseInt(PORT), () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║           x402 Express E2E Test Server                 ║
╠════════════════════════════════════════════════════════╣
║  Server:       http://localhost:${PORT}                ║
║  AVM Network:  ${AVM_NETWORK}                          ║
║  EVM Network:  ${EVM_NETWORK}                          ║
║  SVM Network:  ${SVM_NETWORK}                          ║
║  Aptos Network: ${APTOS_NETWORK}                       ║
║  Hedera Network: ${HEDERA_NETWORK}                     ║
║  Stellar Network: ${STELLAR_NETWORK}║
║  Cardano Network: ${CARDANO_NETWORK}║
║  TVM Network: ${TVM_NETWORK}║
║  CCD Network:  ${CCD_NETWORK}                          ║
║  AVM Payee:    ${AVM_PAYEE_ADDRESS || "(not configured)"}
║  EVM Payee:    ${EVM_PAYEE_ADDRESS}                    ║
║  SVM Payee:    ${SVM_PAYEE_ADDRESS}                    ║
║  Aptos Payee:  ${APTOS_PAYEE_ADDRESS || "(not configured)"}
║  Hedera Payee: ${HEDERA_PAYEE_ADDRESS || "(not configured)"}
║  Keeta Payee:  ${KEETA_PAYEE_ADDRESS || "(not configured)"}
║  CCD Payee:    ${CCD_PAYEE_ADDRESS || "(not configured)"}
║  Stellar Payee: ${STELLAR_PAYEE_ADDRESS || "(not configured)"}
║  Cardano Payee: ${CARDANO_PAYEE_ADDRESS || "(not configured)"}
║  TVM Payee: ${TVM_PAYEE_ADDRESS || "(not configured)"}
║                                                        ║
║  Endpoints:                                            ║
║  • GET  /exact/avm                            (AVM)           ║
║  • GET  /exact/evm/eip3009                    (EVM EIP-3009)  ║
║  • GET  /batch-settlement/evm/eip3009         (Batch-settlement) ║
║  • GET  /batch-settlement/evm/permit2         (Batch Permit2)  ║
║  • GET  /batch-settlement/evm/permit2-eip2612GasSponsoring    ║
║  • GET  /batch-settlement/evm/permit2-erc20ApprovalGasSponsoring ║
║  • GET  /exact/evm/permit2                    (Permit2)       ║
║  • GET  /exact/evm/permit2-eip2612GasSponsoring               ║
║  • GET  /exact/evm/permit2-erc20ApprovalGasSponsoring         ║
║  • GET  /exact/svm                            (SVM)           ║
║  • GET  /exact/aptos                          (Aptos)         ║
║  • GET  /exact/hedera                         (Hedera)        ║
║  • GET  /exact/keeta                           (Keeta)        ║
║  • GET  /exact/stellar                        (Stellar)       ║
║  • GET  /exact/cardano/default                (Cardano)       ║
║  • GET  /exact/cardano/masumi                 (Cardano)       ║
║  • GET  /exact/cardano/script                 (Cardano)       ║
║  • GET  /exact/tvm                            (TVM)           ║
║  • GET  /health                (no payment required)       ║
║  • POST /close                 (shutdown server)           ║
╚════════════════════════════════════════════════════════╝
  `);
});
