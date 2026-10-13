package org.x402.core.facilitator;

import org.x402.core.hooks.HookResults.Decision;
import org.x402.core.hooks.HookResults.Recovery;
import org.x402.core.types.PaymentPayload;
import org.x402.core.types.PaymentRequirements;
import org.x402.core.types.SettleResponse;
import org.x402.core.types.VerifyResponse;

/** Facilitator hook types and contexts (TS {@code facilitator/x402Facilitator.ts:20-62}). */
public final class FacilitatorHooks {

  private FacilitatorHooks() {}

  /**
   * Context of a facilitator verify call.
   *
   * @param paymentPayload the client's payload
   * @param requirements the requirements
   */
  public record VerifyContext(PaymentPayload paymentPayload, PaymentRequirements requirements) {}

  /**
   * Context after a facilitator verify call.
   *
   * @param paymentPayload the client's payload
   * @param requirements the requirements
   * @param result the result
   */
  public record VerifyResultContext(
      PaymentPayload paymentPayload, PaymentRequirements requirements, VerifyResponse result) {}

  /**
   * Context of a failed facilitator verify call.
   *
   * @param paymentPayload the client's payload
   * @param requirements the requirements
   * @param error the failure
   */
  public record VerifyFailureContext(
      PaymentPayload paymentPayload, PaymentRequirements requirements, Throwable error) {}

  /**
   * Context of a facilitator settle call.
   *
   * @param paymentPayload the client's payload
   * @param requirements the requirements
   */
  public record SettleContext(PaymentPayload paymentPayload, PaymentRequirements requirements) {}

  /**
   * Context after a facilitator settle call.
   *
   * @param paymentPayload the client's payload
   * @param requirements the requirements
   * @param result the result
   */
  public record SettleResultContext(
      PaymentPayload paymentPayload, PaymentRequirements requirements, SettleResponse result) {}

  /**
   * Context of a failed facilitator settle call.
   *
   * @param paymentPayload the client's payload
   * @param requirements the requirements
   * @param error the failure
   */
  public record SettleFailureContext(
      PaymentPayload paymentPayload, PaymentRequirements requirements, Throwable error) {}

  /** Before verify; an abort answers {@code isValid:false} with the reason (TS :293-300). */
  @FunctionalInterface
  public interface BeforeVerifyHook {
    /**
     * Runs the hook.
     *
     * @param context the context
     * @return proceed or abort
     */
    Decision apply(VerifyContext context);
  }

  /** After verify. */
  @FunctionalInterface
  public interface AfterVerifyHook {
    /**
     * Runs the hook.
     *
     * @param context the context
     */
    void apply(VerifyResultContext context);
  }

  /** When verify throws; may recover with a result (TS :353). */
  @FunctionalInterface
  public interface OnVerifyFailureHook {
    /**
     * Runs the hook.
     *
     * @param context the context
     * @return no recovery or a recovered result
     */
    Recovery<VerifyResponse> apply(VerifyFailureContext context);
  }

  /** Before settle; an abort throws {@code SettleAbortedException} (TS :415-419). */
  @FunctionalInterface
  public interface BeforeSettleHook {
    /**
     * Runs the hook.
     *
     * @param context the context
     * @return proceed or abort
     */
    Decision apply(SettleContext context);
  }

  /** After settle. */
  @FunctionalInterface
  public interface AfterSettleHook {
    /**
     * Runs the hook.
     *
     * @param context the context
     */
    void apply(SettleResultContext context);
  }

  /** When settle throws; may recover with a result. */
  @FunctionalInterface
  public interface OnSettleFailureHook {
    /**
     * Runs the hook.
     *
     * @param context the context
     * @return no recovery or a recovered result
     */
    Recovery<SettleResponse> apply(SettleFailureContext context);
  }
}
