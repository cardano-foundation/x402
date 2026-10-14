package org.x402.mechanisms.cardano.exact.facilitator;

import java.util.Objects;

/**
 * One atomic facilitator claim.
 *
 * @param txHash the canonical transaction id (body hash), never the CBOR
 * @param ownerToken an unpredictable token owning a fresh claim
 * @param termsDigest the Masumi terms digest, or {@code null}
 * @param retainUntilMs once broadcast, keep the record at least until this POSIX time (the
 *     transaction's TTL plus 120 s grace), or {@code null} when unknown: never evicted once
 *     broadcast
 */
public record SettlementClaim(String txHash, String ownerToken, String termsDigest, Long retainUntilMs) {

  /** Validates. */
  public SettlementClaim {
    Objects.requireNonNull(txHash, "txHash");
    Objects.requireNonNull(ownerToken, "ownerToken");
  }
}
