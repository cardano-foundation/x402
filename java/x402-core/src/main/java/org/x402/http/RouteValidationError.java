package org.x402.http;

/**
 * One route configuration problem (TS {@code RouteValidationError}), with the option index and
 * facilitator for the Java pin rules.
 *
 * @param route the route key, or {@code null} for a problem not tied to a route (a registered
 *     scheme the facilitators cannot serve)
 * @param scheme the option's scheme
 * @param network the option's network
 * @param reason the reason
 * @param message the message; TS wording where TS has the check
 * @param optionIndex the option's index in {@code accepts}, or {@code null}
 * @param facilitator the facilitator involved, or {@code null}
 * @param retryable whether a re-sync may heal it (a facilitator that could serve it failed)
 */
public record RouteValidationError(
    String route,
    String scheme,
    String network,
    Reason reason,
    String message,
    Integer optionIndex,
    String facilitator,
    boolean retryable) {

  /** Why a route is invalid. */
  public enum Reason {
    /** No server scheme registered (TS). */
    MISSING_SCHEME("missing_scheme"),
    /** No facilitator lists the kind, or the pinned one does not (TS + Java pin). */
    MISSING_FACILITATOR("missing_facilitator"),
    /** The scheme lacks the transfer method (TS). */
    UNSUPPORTED_ASSET_TRANSFER_METHOD("unsupported_asset_transfer_method"),
    /** The transfer method lacks the payment flow (TS). */
    UNSUPPORTED_PAYMENT_FLOW("unsupported_payment_flow"),
    /** The pin names no configured facilitator (Java). */
    UNKNOWN_FACILITATOR("unknown_facilitator"),
    /** The facilitator's kind cannot serve the option (TS capability check; Java per option). */
    FACILITATOR_CAPABILITY("facilitator_capability"),
    /** Two options with different routing policies can match one payment (Java). */
    AMBIGUOUS_OPTIONS("ambiguous_options");

    private final String wire;

    Reason(String wire) {
      this.wire = wire;
    }

    /**
     * The TS-style reason string.
     *
     * @return the string
     */
    public String wire() {
      return wire;
    }
  }
}
