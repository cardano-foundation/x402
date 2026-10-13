package org.x402.spring.facilitator;

import org.x402.core.facilitator.X402Facilitator;

/**
 * Customizes the auto-configured facilitator: hooks ({@code onBeforeVerify}, …) and schemes.
 * Customizers run before the Cardano schemes are registered, and auto-configuration registers a
 * Cardano scheme only for (scheme, network) pairs no customizer claimed, so a custom scheme wins.
 */
@FunctionalInterface
public interface X402FacilitatorCustomizer {

  /**
   * Customizes the facilitator.
   *
   * @param facilitator the facilitator
   */
  void customize(X402Facilitator facilitator);
}
