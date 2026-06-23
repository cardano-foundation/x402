import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { server, CARDANO_PAYEE_ADDRESS, CARDANO_NETWORK } from "@/proxy";

/**
 * Handler for the protected endpoint
 */
const handler = async (_: NextRequest) => {
  return NextResponse.json({
    message: "Protected Cardano endpoint accessed successfully (withX402)",
    timestamp: new Date().toISOString(),
  });
};

/**
 * Protected Cardano endpoint using withX402 wrapper
 * Only exported if CARDANO_PAYEE_ADDRESS is configured
 */
export const GET = CARDANO_PAYEE_ADDRESS
  ? withX402(
      handler,
      {
        accepts: {
          payTo: CARDANO_PAYEE_ADDRESS,
          scheme: "exact",
          price: "$0.001",
          network: CARDANO_NETWORK,
        },
        extensions: {
          ...declareDiscoveryExtension({
            output: {
              example: {
                message: "Protected Cardano endpoint accessed successfully (withX402)",
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
      server,
    )
  : async () => {
      return NextResponse.json({ error: "Cardano not configured" }, { status: 503 });
    };
