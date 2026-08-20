import { ExactAvmScheme } from "@x402/avm/exact/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { UptoEvmScheme } from "@x402/evm/upto/server";
import { BatchSettlementEvmScheme } from "@x402/evm/batch-settlement/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { UptoSvmScheme } from "@x402/svm/upto/server";
import { base58 } from "@scure/base";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { ExactAptosScheme } from "@x402/aptos/exact/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { ExactKeetaScheme } from "@x402/keeta/exact/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { ExactTvmScheme } from "@x402/tvm/exact/server";
import { ExactNearScheme } from "@x402/near/exact/server";
import { ExactXrplScheme } from "@x402/xrpl/exact/server";
import { ExactConcordiumScheme } from "@x402/concordium/exact/server";
import { ExactCardanoScheme } from "@x402/cardano/exact/server";
import { issueMasumiRequirements, toMasumiSellerSigner } from "@x402/cardano";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import {
  declareEip2612GasSponsoringExtension,
  declareErc20ApprovalGasSponsoringExtension,
} from "@x402/extensions";
import { HTTPFacilitatorClient, type RoutesConfig, type x402ResourceServer } from "@x402/core/server";
import type { HTTPRequestContext } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import { privateKeyToAccount } from "viem/accounts";
import type { Caip2Network, ServerEnvConfig } from "../../src/server-env";
import {
  getServerAddress,
  isFamilyConfigured,
} from "../../src/server-env";
import {
  PROTOCOL_FAMILIES,
  type ProtocolFamily,
} from "../../src/networks/networks";
import { resolvedRoutes, type ResolvedRoute } from "./catalog";
import {
  networkCaip2Pattern,
  routeDiscoveryOutput,
  mcpToolName,
  type RouteTransport,
} from "../../src/mechanisms";

export type { Caip2Network, ServerEnvConfig } from "../../src/server-env";
export { loadServerEnv } from "../../src/server-env";

/**
 * Cardano settles on ~20-second blocks, so its `settle()` cannot finish inside
 * the 30s facilitator-client default. Fast chains still return as soon as done.
 */
const FACILITATOR_TIMEOUT_MS = 180_000;

/**
 * Builds facilitator clients from FACILITATOR_URL (+ optional MOCK_FACILITATOR_URL).
 */
export function createFacilitatorClients(facilitatorUrl: string): HTTPFacilitatorClient[] {
  const facilitatorClients = [
    new HTTPFacilitatorClient({ url: facilitatorUrl, timeoutMs: FACILITATOR_TIMEOUT_MS }),
  ];
  const mockFacilitatorUrl = process.env.MOCK_FACILITATOR_URL;
  if (mockFacilitatorUrl) {
    facilitatorClients.push(
      new HTTPFacilitatorClient({ url: mockFacilitatorUrl, timeoutMs: FACILITATOR_TIMEOUT_MS }),
    );
  }
  return facilitatorClients;
}

/** Register schemes for one configured family. */
async function registerFamilySchemes(
  server: x402ResourceServer,
  family: ProtocolFamily,
  cfg: ServerEnvConfig,
): Promise<void> {
  const pattern = networkCaip2Pattern(family);

  switch (family) {
    case "avm":
      server.register(pattern, new ExactAvmScheme());
      return;
    case "ccd":
      server.register(pattern, new ExactConcordiumScheme());
      return;
    case "cardano":
      server.register(pattern, new ExactCardanoScheme({ inMemoryStore: {} }));
      return;
    case "evm": {
      server.register(pattern, new ExactEvmScheme());
      server.register(pattern, new UptoEvmScheme());
      const receiverAuthorizerPrivateKey = process.env.SERVER_EVM_RECEIVER_AUTHORIZER_PRIVATE_KEY as
        | `0x${string}`
        | undefined;
      const receiverAuthorizerSigner = receiverAuthorizerPrivateKey
        ? privateKeyToAccount(receiverAuthorizerPrivateKey)
        : undefined;
      const payTo = getServerAddress(cfg, "evm") as `0x${string}`;
      server.register(
        pattern,
        new BatchSettlementEvmScheme(payTo, {
          ...(receiverAuthorizerSigner ? { receiverAuthorizerSigner } : {}),
        }),
      );
      return;
    }
    case "svm": {
      server.register(pattern, new ExactSvmScheme());
      const receiverAuthorizerPrivateKey = process.env.SERVER_SVM_RECEIVER_AUTHORIZER_PRIVATE_KEY;
      if (receiverAuthorizerPrivateKey) {
        const receiverAuthorizerSigner = await createKeyPairSignerFromBytes(
          base58.decode(receiverAuthorizerPrivateKey),
        );
        console.info(`SVM receiver authorizer: ${receiverAuthorizerSigner.address}`);
        server.register(
          pattern,
          new UptoSvmScheme({
            receiverAuthorizerSigner,
            rpcUrl: process.env.SVM_RPC_URL,
          }),
        );
      }
      return;
    }
    case "aptos":
      server.register(pattern, new ExactAptosScheme());
      return;
    case "hedera":
      server.register(pattern, new ExactHederaScheme());
      return;
    case "keeta":
      server.register(pattern, new ExactKeetaScheme());
      return;
    case "stellar":
      server.register(pattern, new ExactStellarScheme());
      return;
    case "tvm":
      server.register(pattern, new ExactTvmScheme());
      return;
    case "near":
      server.register(pattern, new ExactNearScheme());
      return;
    case "xrpl":
      server.register(pattern, new ExactXrplScheme());
      return;
  }
}

/**
 * Registers e2e schemes + bazaar extension for every family with a payee address
 * configured (catalog-driven via {@link isFamilyConfigured}).
 */
export async function configureResourceServer(server: x402ResourceServer, cfg: ServerEnvConfig): Promise<void> {
  for (const family of PROTOCOL_FAMILIES) {
    if (isFamilyConfigured(cfg, family)) {
      await registerFamilySchemes(server, family, cfg);
    }
  }

  server.registerExtension(bazaarResourceServerExtension);
}

/**
 * Maps a catalog extension id to the SDK call that declares it on a route.
 * Declaration comes from mechanisms JSON `extensions` per route; process-level
 * registration (e.g. {@link configureResourceServer}'s bazaar handler) is
 * separate and enables enriching/honoring those declarations.
 */
function declareExtension(
  id: string,
  route: ResolvedRoute,
  transport: RouteTransport = "http",
): Record<string, unknown> {
  switch (id) {
    case "bazaar":
      return transport === "mcp"
        ? declareDiscoveryExtension({
          toolName: mcpToolName(route.path),
          transport: "sse",
          inputSchema: { type: "object", properties: {} },
          output: routeDiscoveryOutput(),
        })
        : declareDiscoveryExtension({ output: routeDiscoveryOutput() });
    case "eip2612GasSponsoring":
      return declareEip2612GasSponsoringExtension();
    case "erc20ApprovalGasSponsoring":
      return declareErc20ApprovalGasSponsoringExtension();
    default:
      throw new Error(`Route ${route.path} declares unknown extension "${id}"`);
  }
}

// How long a Cardano Masumi payment stays valid. The client anchors the tx TTL to
// pay_by_time and the facilitator refuses a TTL further ahead than maxTimeoutSeconds.
const CARDANO_MASUMI_MAX_TIMEOUT_SECONDS = 600;
// Canonical block inclusion is the bar for the e2e: the spec default of 1 would
// make every Cardano scenario wait an extra ~20s block for no added signal.
const CARDANO_MASUMI_CONFIRMATION_POLICY = { l1Confirmations: 0 };
// The seller signs the Masumi terms with its selling wallet; the escrow pays that
// address. A real deployment MUST set SERVER_CARDANO_SELLER_MNEMONIC — the
// well-known test phrase only keeps the e2e self-contained. It needs no funds.
const CARDANO_TEST_SELLER_MNEMONIC = "test test test test test test test test test test test junk";

type CardanoMasumiOfferState = {
  seller: ReturnType<typeof toMasumiSellerSigner>;
  offer?: Promise<PaymentRequirements>;
  rotatedFor: WeakSet<object>;
};

// Keyed by network + path: the Next e2e server rebuilds route configs per
// request, so the one-shot offer must outlive a single `buildResolvedRouteConfig`.
const cardanoMasumiOffers = new Map<string, CardanoMasumiOfferState>();

/**
 * Route `accepts` for a Cardano Masumi escrow route (catalog `schemeOptions.masumi`).
 *
 * A spec-conformant Masumi 402 carries a request commitment and a seller
 * signature over `termsDigest`, so it must be issued rather than hand-written.
 * `termsDigest` binds to exactly one settled transaction, which makes an offer
 * one-shot: a fresh one is issued for every unpaid request, while a paid retry
 * sees the offer it was quoted (re-issuing would change `termsDigest`).
 */
function cardanoMasumiAccepts(route: ResolvedRoute): Record<string, unknown> {
  if (typeof route.price === "string") {
    throw new Error(`Route ${route.path}: Masumi requires an amount/asset price`);
  }
  const { amount, asset } = route.price;
  const key = `${route.network}|${route.path}`;
  let state = cardanoMasumiOffers.get(key);
  if (!state) {
    state = {
      seller: toMasumiSellerSigner({
        mnemonic: process.env.SERVER_CARDANO_SELLER_MNEMONIC || CARDANO_TEST_SELLER_MNEMONIC,
        network: route.network,
      }),
      rotatedFor: new WeakSet<object>(),
    };
    cardanoMasumiOffers.set(key, state);
  }
  const { seller } = state;
  const issue = (): Promise<PaymentRequirements> => {
    const payByMs = Date.now() + CARDANO_MASUMI_MAX_TIMEOUT_SECONDS * 1000;
    return issueMasumiRequirements({
      network: route.network,
      asset,
      amount,
      maxTimeoutSeconds: CARDANO_MASUMI_MAX_TIMEOUT_SECONDS,
      sellerAddress: seller.sellerAddress,
      signTerms: seller.signTerms,
      commitment: [
        {
          name: "parameters",
          canonicalization: "jcs",
          mediaType: "application/json",
          content: { endpoint: route.path },
        },
      ],
      // Each deadline clears its spec minimum by 5 minutes rather than landing
      // exactly on it (pay_by + 5min <= submit_result, +15min <= unlock, +15min <= dispute).
      payByTime: payByMs.toString(),
      submitResultTime: (payByMs + 10 * 60_000).toString(),
      unlockTime: (payByMs + 30 * 60_000).toString(),
      externalDisputeUnlockTime: (payByMs + 50 * 60_000).toString(),
      settlementPolicy: "l1",
      confirmationPolicy: CARDANO_MASUMI_CONFIRMATION_POLICY,
    });
  };

  // payTo and price both resolve from the same request context; rotate once per
  // unpaid request regardless of which resolves first.
  const current = (context: HTTPRequestContext): Promise<PaymentRequirements> => {
    if (!state.offer || (!context.paymentHeader && !state.rotatedFor.has(context))) {
      state.rotatedFor.add(context);
      state.offer = issue();
    }
    return state.offer;
  };

  return {
    scheme: route.scheme,
    network: route.network as Caip2Network,
    maxTimeoutSeconds: CARDANO_MASUMI_MAX_TIMEOUT_SECONDS,
    payTo: async (context: HTTPRequestContext) => (await current(context)).payTo,
    price: async (context: HTTPRequestContext) => {
      const issued = await current(context);
      return { amount: issued.amount, asset: issued.asset, extra: issued.extra };
    },
  };
}

/** Single-route payment config shared by HTTP frameworks, the Next e2e server, and MCP tools. */
export function buildResolvedRouteConfig(
  route: ResolvedRoute,
  transport: RouteTransport = "http",
): Record<string, unknown> {
  const extensions = Object.assign({}, ...route.extensions.map(id => declareExtension(id, route, transport)));

  const accepts = route.schemeOptions?.masumi
    ? cardanoMasumiAccepts(route)
    : {
        payTo: route.payTo,
        scheme: route.scheme,
        network: route.network as Caip2Network,
        price: route.price,
        ...(route.extra ? { extra: route.extra } : {}),
      };

  return {
    accepts,
    ...(route.extensions.length > 0 ? { extensions } : {}),
  };
}

/**
 * Payment-middleware route map for the express/hono/fastify e2e servers, derived
 * from config/mechanisms.json. Routes whose network has no payee address
 * configured are omitted by the resolver.
 */
export function buildPaymentRoutes(cfg: ServerEnvConfig): RoutesConfig {
  const routes: Record<string, unknown> = {};

  for (const route of resolvedRoutes(cfg)) {
    routes[`GET ${route.path}`] = buildResolvedRouteConfig(route);
  }

  return routes as RoutesConfig;
}
