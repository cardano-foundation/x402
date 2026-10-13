package org.x402.spring;

import org.x402.core.client.X402Client;

/** Client registration queries used by the auto-configured scheme defaults (decision 153). */
public final class ClientSchemes {

  private ClientSchemes() {}

  /**
   * Whether a scheme is registered for a network, wildcards included, via core's {@link
   * X402Client#hasRegisteredScheme(String, String)}.
   *
   * @param client the client
   * @param network the network
   * @param scheme the scheme
   * @return {@code true} when registered
   */
  public static boolean isRegistered(X402Client client, String network, String scheme) {
    return client.hasRegisteredScheme(network, scheme);
  }
}
