package org.x402.mechanisms.cardano.chain;

/**
 * Chain access for the Cardano facilitator, mirroring TS {@code FacilitatorCardanoSigner}
 * ({@code signer.ts:330-465}) minus {@code getAddresses}: the facilitator's addresses come from
 * the separate, optional signer of {@code ExactCardanoFacilitatorScheme} (decision 045).
 *
 * <p>TS optional members are default methods. Where TS changes behaviour on the mere presence
 * of a member ({@code getTransactionEvidence}, {@code validatePhase1Transaction}, {@code
 * getProtocolParameters}), Java asks a capability method or a {@code null} answer instead
 * (decision 046). Implementations must be thread-safe.
 */
public interface CardanoChainBackend {

  /**
   * Looks up one UTxO. Returns {@code exists = false} when it is spent or never existed, and
   * throws when the lookup itself fails.
   *
   * @param ref the reference {@code txHash#index}
   * @param network the x402 network
   * @return the snapshot
   */
  UtxoSnapshot getUtxo(String ref, String network);

  /**
   * The current absolute slot.
   *
   * @param network the x402 network
   * @return the slot
   */
  long getCurrentSlot(String network);

  /**
   * Live protocol parameters (TS optional {@code getProtocolParameters}). Throws when the read
   * fails.
   *
   * @param network the x402 network
   * @return the parameters, or {@code null} when this backend does not offer them (the fee
   *     floor and min-UTxO checks are then skipped, as in TS)
   */
  default ProtocolParameters getProtocolParameters(String network) {
    return null;
  }

  /**
   * Broadcasts a fully signed transaction, exactly these bytes.
   *
   * @param signedTransactionBase64 the transaction
   * @param network the x402 network
   * @return the submission result
   */
  SubmissionResult submitTransaction(String signedTransactionBase64, String network);

  /**
   * Whether a submission error definitively proves the transaction was rejected before it could
   * be accepted. Ambiguous transport, timeout and provider errors must answer {@code false}.
   *
   * @param error the error {@link #submitTransaction} threw
   * @return true only for a definitive rejection
   */
  default boolean isDefinitiveSubmissionRejection(Throwable error) {
    return false;
  }

  /**
   * Waits for a submitted transaction (TS optional {@code waitForConfirmation}). The facilitator
   * scheme does not call it; it is kept for parity.
   *
   * @param txHash the transaction id
   * @param network the x402 network
   */
  default void waitForConfirmation(String txHash, String network) {}

  /**
   * Dry-runs Plutus scripts (TS optional {@code evaluateTransaction}); throws on rejection. The
   * default does nothing, which is what TS does when the member is absent.
   *
   * @param signedTransactionBase64 the transaction
   * @param network the x402 network
   */
  default void evaluateTransaction(String signedTransactionBase64, String network) {}

  /**
   * Whether {@link #getTransactionEvidence} is implemented. Without it the facilitator cannot
   * settle depths above canonical inclusion or resume a pending settlement by evidence, and
   * advertises {@code l1Confirmations.maximum = 0}.
   *
   * @return true when evidence can be read
   */
  default boolean supportsTransactionEvidence() {
    return false;
  }

  /**
   * Authenticated evidence for one transaction. Must report {@code unknown} when the ledger has
   * no record (and for a phase-2-invalid transaction); throws only on lookup failure.
   *
   * @param txHash the transaction id
   * @param network the x402 network
   * @return the evidence
   */
  default SettlementEvidence getTransactionEvidence(String txHash, String network) {
    throw new UnsupportedOperationException("this backend cannot read transaction evidence");
  }

  /**
   * Whether a complete ledger phase-1 validator is available ({@link
   * #validatePhase1Transaction}). It is the only way to accept balance-changing operations.
   *
   * @return true when available
   */
  default boolean supportsPhase1Validation() {
    return false;
  }

  /**
   * Runs a complete phase-1 validation; must throw unless the transaction passes every rule.
   *
   * @param signedTransactionBase64 the transaction
   * @param network the x402 network
   */
  default void validatePhase1Transaction(String signedTransactionBase64, String network) {
    throw new UnsupportedOperationException("this backend has no phase-1 validator");
  }
}
