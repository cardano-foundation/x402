package org.x402.http;

/** Resolves a receiving address per request (TS {@code DynamicPayTo}). */
@FunctionalInterface
public interface DynamicPayTo {

  /**
   * Resolves the address.
   *
   * @param context the request
   * @return the address
   */
  String resolve(HttpRequestContext context);
}
