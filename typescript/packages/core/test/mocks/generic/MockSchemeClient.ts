import {
  PaymentPayloadContext,
  SchemeClientHooks,
  SchemeNetworkClient,
} from "../../../src/types/mechanisms";
import { PaymentPayload, PaymentRequirements } from "../../../src/types/payments";

/**
 * Mock scheme network client for testing.
 */
export class MockSchemeNetworkClient implements SchemeNetworkClient {
  public readonly scheme: string;
  public readonly schemeHooks?: SchemeClientHooks;
  private payloadResult: Pick<PaymentPayload, "x402Version" | "payload"> | Error;

  // Call tracking
  public createPaymentPayloadCalls: Array<{
    x402Version: number;
    requirements: PaymentRequirements;
    context?: PaymentPayloadContext;
  }> = [];

  /**
   *
   * @param scheme
   * @param payloadResult
   */
  constructor(
    scheme: string,
    payloadResult?: Pick<PaymentPayload, "x402Version" | "payload"> | Error,
    schemeHooks?: SchemeClientHooks,
  ) {
    this.scheme = scheme;
    this.payloadResult = payloadResult || {
      x402Version: 2,
      payload: { signature: "mock_signature", from: "mock_address" },
    };
    this.schemeHooks = schemeHooks;
  }

  /**
   *
   * @param x402Version
   * @param paymentRequirements
   * @param context
   */
  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
    context?: PaymentPayloadContext,
  ): Promise<Pick<PaymentPayload, "x402Version" | "payload">> {
    this.createPaymentPayloadCalls.push({
      x402Version,
      requirements: paymentRequirements,
      ...(context ? { context } : {}),
    });

    if (this.payloadResult instanceof Error) {
      throw this.payloadResult;
    }
    return this.payloadResult;
  }

  // Helper methods for test configuration
  /**
   *
   * @param result
   */
  setPayloadResult(result: Pick<PaymentPayload, "x402Version" | "payload"> | Error): void {
    this.payloadResult = result;
  }

  /**
   *
   */
  reset(): void {
    this.createPaymentPayloadCalls = [];
  }
}
