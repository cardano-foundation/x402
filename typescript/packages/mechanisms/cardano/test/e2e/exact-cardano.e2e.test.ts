import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { x402Client } from "@x402/core/client";
import { x402Facilitator } from "@x402/core/facilitator";
import { x402ResourceServer, x402HTTPResourceServer, FacilitatorClient } from "@x402/core/server";
import { x402HTTPClient } from "@x402/core/http";
import {
  Network,
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
  SupportedResponse,
} from "@x402/core/types";
import { paymentMiddlewareFromHTTPServer } from "@x402/express";
import { wrapFetchWithPayment } from "@x402/fetch";

import { ExactCardanoScheme as ExactCardanoClient } from "../../src/exact/client/scheme";
import { ExactCardanoScheme as ExactCardanoFacilitator } from "../../src/exact/facilitator/scheme";
import { ExactCardanoScheme as ExactCardanoServer } from "../../src/exact/server/scheme";
import {
  freshPreprodAddress,
  NETWORK,
  stubClientSigner,
  stubFacilitatorSigner,
} from "../helpers/stubs";

/**
 * Wraps the in-process x402Facilitator so the resource server settles without a
 * separate facilitator HTTP service. This keeps the e2e test standalone.
 */
class CardanoFacilitatorClient implements FacilitatorClient {
  readonly scheme = "exact";
  readonly network: Network = NETWORK;
  readonly x402Version = 2;

  /**
   * @param facilitator - The x402 facilitator to wrap.
   */
  constructor(private readonly facilitator: x402Facilitator) {}

  /**
   * @param payload - The payment payload to verify.
   * @param requirements - The payment requirements.
   * @returns The verification response.
   */
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    return this.facilitator.verify(payload, requirements);
  }

  /**
   * @param payload - The payment payload to settle.
   * @param requirements - The payment requirements.
   * @returns The settlement response.
   */
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    return this.facilitator.settle(payload, requirements);
  }

  /**
   * @returns The supported payment kinds.
   */
  getSupported(): Promise<SupportedResponse> {
    return Promise.resolve(this.facilitator.getSupported());
  }
}

describe("Cardano E2E (standalone HTTP, deterministic)", () => {
  let server: Server;
  let baseUrl: string;
  let recipient: string;

  beforeAll(async () => {
    recipient = await freshPreprodAddress();

    const facilitator = new x402Facilitator().register(
      NETWORK,
      new ExactCardanoFacilitator(stubFacilitatorSigner()),
    );
    const resourceServer = new x402ResourceServer(new CardanoFacilitatorClient(facilitator));
    resourceServer.register(NETWORK, new ExactCardanoServer());

    const routes = {
      "/api/protected": {
        accepts: {
          scheme: "exact",
          payTo: recipient,
          price: "$0.001",
          network: NETWORK,
        },
        description: "Premium Cardano resource",
        mimeType: "application/json",
      },
    };
    const httpServer = new x402HTTPResourceServer(resourceServer, routes);

    const app = express();
    app.use(paymentMiddlewareFromHTTPServer(httpServer));
    app.get("/api/protected", (_req, res) => {
      res.json({ data: "premium" });
    });

    server = await new Promise<Server>(resolve => {
      const s = app.listen(0, () => resolve(s));
    });
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    server?.close();
  });

  it("returns 402 for an unpaid request", async () => {
    const res = await fetch(`${baseUrl}/api/protected`);
    expect(res.status).toBe(402);
  });

  it("pays over HTTP and receives the protected resource with a settlement", async () => {
    const client = new x402Client().register(NETWORK, new ExactCardanoClient(stubClientSigner()));
    const fetchWithPayment = wrapFetchWithPayment(fetch, client);

    const res = await fetchWithPayment(`${baseUrl}/api/protected`, { method: "GET" });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: string };
    expect(body.data).toBe("premium");

    const settlement = new x402HTTPClient(client).getPaymentSettleResponse(name =>
      res.headers.get(name),
    );
    expect(settlement?.success).toBe(true);
    expect(settlement?.network).toBe(NETWORK);
  });
});
