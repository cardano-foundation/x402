package org.x402.mechanisms.cardano.exact.facilitator;

import java.math.BigInteger;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Objects;
import java.util.Set;
import org.x402.core.FacilitatorContext;
import org.x402.core.SchemeNetworkFacilitator;
import org.x402.core.types.PaymentPayload;
import org.x402.core.types.PaymentRequirements;
import org.x402.core.types.SettleResponse;
import org.x402.core.types.VerifyResponse;
import org.x402.mechanisms.cardano.CardanoConstants;
import org.x402.mechanisms.cardano.CardanoErrors;
import org.x402.mechanisms.cardano.CardanoNetworks;
import org.x402.mechanisms.cardano.CardanoPolicies;
import org.x402.mechanisms.cardano.CardanoTransactionDecoder;
import org.x402.mechanisms.cardano.CardanoUtils;
import org.x402.mechanisms.cardano.DecodedCardanoTransaction;
import org.x402.mechanisms.cardano.chain.CardanoChainBackend;
import org.x402.mechanisms.cardano.chain.ProtocolParameters;
import org.x402.mechanisms.cardano.chain.SettlementEvidence;
import org.x402.mechanisms.cardano.chain.SubmissionResult;
import org.x402.mechanisms.cardano.chain.UtxoSnapshot;
import org.x402.mechanisms.cardano.exact.masumi.MasumiDigests;
import org.x402.mechanisms.cardano.exact.masumi.MasumiSchema;
import org.x402.mechanisms.cardano.exact.masumi.MasumiVerifier;
import org.x402.mechanisms.cardano.exact.script.ScriptAddresses;

/**
 * Cardano facilitator for the {@code exact} scheme, a line-by-line port of TS {@code
 * exact/facilitator/scheme.ts} (2.28.0). It enforces the spec's facilitator verification rules
 * 1–9 plus the Masumi and script checks before accepting a payment, then broadcasts the client's
 * signed transaction and waits, bounded, for the evidence the selected {@code
 * confirmationPolicy} requires. Below it the answer is {@code settlement_pending} with the
 * transaction id; the retry resumes observing the same transaction, never broadcasting it again
 * while its claim is retained.
 *
 * <p><b>Security divergence from TS (decision 013):</b> TS's verify accepts ledger evidence of
 * the transaction as validity and its settle resumes any submitted claim to success, so a landed
 * payment can be replayed. Here public verify always enforces the TTL window and unspent inputs
 * and refuses any transaction the claim store knows, and a transaction is reported settled
 * exactly once.
 *
 * <p>The duplicate-settlement guard is keyed by the canonical transaction id. The default store
 * is process-local and bounded (decision 006); several replicas need a shared {@link
 * SettlementClaimStore}. With a {@code null} signer the facilitator runs provider-only.
 */
public class ExactCardanoFacilitatorScheme implements SchemeNetworkFacilitator {

  private static final long VALIDITY_CLOSE_GRACE_MS = 120_000L;
  private static final SecureRandom RANDOM = new SecureRandom();

  private final CardanoChainBackend backend;
  private final CardanoFacilitatorSigner signer;
  private final ExactCardanoFacilitatorOptions options;

  /**
   * A provider-only facilitator with the default options.
   *
   * @param backend the chain backend
   */
  public ExactCardanoFacilitatorScheme(CardanoChainBackend backend) {
    this(backend, null, ExactCardanoFacilitatorOptions.defaults());
  }

  /**
   * Creates the facilitator scheme.
   *
   * @param backend the chain backend
   * @param signer the facilitator's addresses for {@code /supported}, or {@code null}
   *     (provider-only)
   * @param options the options, or {@code null} for the defaults
   */
  public ExactCardanoFacilitatorScheme(
      CardanoChainBackend backend, CardanoFacilitatorSigner signer, ExactCardanoFacilitatorOptions options) {
    this.backend = Objects.requireNonNull(backend, "backend");
    this.signer = signer;
    this.options = options == null ? ExactCardanoFacilitatorOptions.defaults() : options;
  }

  @Override
  public String scheme() {
    return CardanoConstants.SCHEME_EXACT;
  }

  @Override
  public String caipFamily() {
    return "cardano:*";
  }

  /**
   * The capabilities advertised in {@code /supported}: transfer methods, no fee sponsorship, and
   * the {@code l1Confirmations} range this facilitator can settle.
   *
   * @param network the network
   * @return the capability block
   */
  @Override
  public Map<String, Object> getExtra(String network) {
    Map<String, Object> range = new LinkedHashMap<>();
    range.put("minimum", options.acceptMempool() ? CardanoConstants.MIN_L1_CONFIRMATIONS : 0);
    range.put("maximum", canAuthenticateEvidence() ? CardanoConstants.MAX_L1_CONFIRMATIONS : 0);
    Map<String, Object> extra = new LinkedHashMap<>();
    extra.put(
        "assetTransferMethods",
        List.of(CardanoConstants.METHOD_DEFAULT, CardanoConstants.METHOD_MASUMI, CardanoConstants.METHOD_SCRIPT));
    extra.put("areFeesSponsored", false);
    extra.put("l1Confirmations", range);
    return extra;
  }

  @Override
  public List<String> getSigners(String network) {
    return signer == null ? List.of() : List.copyOf(signer.getAddresses());
  }

  @Override
  public final VerifyResponse verify(
      PaymentPayload payload, PaymentRequirements requirements, FacilitatorContext context) {
    return verify(payload, requirements);
  }

  @Override
  public final SettleResponse settle(
      PaymentPayload payload, PaymentRequirements requirements, FacilitatorContext context) {
    return settle(payload, requirements);
  }

  /**
   * Verifies a payment without broadcasting it.
   *
   * @param payload the payload
   * @param requirements the requirements
   * @return the verdict
   */
  public final VerifyResponse verify(PaymentPayload payload, PaymentRequirements requirements) {
    // Decisions 013/125: the claim store's state decides which verification applies; ledger
    // evidence alone never does.
    String txHash;
    try {
      String transaction = CardanoUtils.decodePayload(payload.payload()).transaction();
      txHash = CardanoTransactionDecoder.decode(transaction).txHash();
    } catch (RuntimeException e) {
      // Undecodable payloads are reported by the verification below.
      return verifyPayment(payload, requirements);
    }
    Optional<SettlementClaimState> state;
    try {
      state = options.settlementStore().claimState(txHash);
    } catch (RuntimeException e) {
      return invalid(CardanoErrors.SETTLEMENT_FAILED, "settlement store unavailable", "");
    }
    if (state == null || state.isEmpty()) {
      return verifyPayment(payload, requirements);
    }
    if (state.get() == SettlementClaimState.SUBMITTED) {
      // The spec's paid retry after a pending outcome repeats the same signature: verify the
      // broadcast transaction as settle's resume does. Settle reports success at most once.
      return verifyBroadcast(payload, requirements);
    }
    return invalid(CardanoErrors.DUPLICATE_SETTLEMENT, null, "");
  }

  /**
   * Verification rules 1-9 and the method checks for a payment that has not been broadcast. It
   * never accepts ledger evidence as validity: the TTL window and unspent inputs always apply
   * (decision 013). Public verify and settle both run it, so an override tightens both alike;
   * the public entry points are final (decision 121). To adjust policy, prefer wrapping the
   * scheme (plan §3a level 6) or a facilitator hook over subclassing.
   *
   * @param payload the payload
   * @param requirements the requirements
   * @return the verdict
   */
  protected VerifyResponse verifyPayment(PaymentPayload payload, PaymentRequirements requirements) {
    return runVerification(payload, requirements, false);
  }

  /**
   * Verification of a transaction this facilitator already broadcast: the pre-broadcast
   * preconditions (unspent inputs, unexpired TTL, phase-1, dry-run) are skipped; recipient,
   * asset, amount and method checks still run. Internal to settle's resume of its own retained
   * claim (decisions 013, 121).
   */
  private VerifyResponse verifyBroadcast(PaymentPayload payload, PaymentRequirements requirements) {
    return runVerification(payload, requirements, true);
  }

  private boolean canAuthenticateEvidence() {
    return backend.supportsTransactionEvidence();
  }

  /** A custom backend's {@code null} evidence or status means "not known" (decisions 123, 127). */
  private SettlementEvidence readEvidence(String txHash, String network) {
    SettlementEvidence evidence = backend.getTransactionEvidence(txHash, network);
    return evidence == null || evidence.status() == null ? SettlementEvidence.unknown() : evidence;
  }

  private static String message(Throwable e) {
    return e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
  }

  private static VerifyResponse invalid(String reason, String message, String payer) {
    return new VerifyResponse(false, reason, message, payer, null, null, null);
  }

  // ---------------------------------------------------------------- verify

  private VerifyResponse runVerification(
      PaymentPayload payload, PaymentRequirements requirements, boolean alreadyBroadcast) {
    try {
      return verification(payload, requirements, alreadyBroadcast);
    } catch (RuntimeException e) {
      return invalid(CardanoErrors.INVALID_PAYLOAD + "_verification_error", message(e), "");
    }
  }

  @SuppressWarnings("checkstyle:MethodLength")
  private VerifyResponse verification(PaymentPayload payload, PaymentRequirements requirements, boolean alreadyBroadcast) {
    if (payload.x402Version() != 2) {
      return invalid(CardanoErrors.INVALID_PAYLOAD + "_unsupported_version", null, "");
    }
    PaymentRequirements accepted = payload.accepted();
    if (accepted == null
        || !CardanoConstants.SCHEME_EXACT.equals(accepted.scheme())
        || !CardanoConstants.SCHEME_EXACT.equals(requirements.scheme())) {
      return invalid(CardanoErrors.UNSUPPORTED_SCHEME, null, "");
    }
    if (!Objects.equals(CardanoNetworks.normalize(accepted.network()), CardanoNetworks.normalize(requirements.network()))) {
      return invalid(CardanoErrors.NETWORK_MISMATCH, null, "");
    }
    if (!CardanoNetworks.isCardanoNetwork(requirements.network())) {
      return invalid(CardanoErrors.NETWORK_MISMATCH, null, "");
    }
    if (requirements.amount() == null
        || requirements.asset() == null
        || !CardanoConstants.POSITIVE_CANONICAL_AMOUNT.matcher(requirements.amount()).matches()
        || !CardanoConstants.CANONICAL_ASSET.matcher(requirements.asset()).matches()) {
      return invalid(
          CardanoErrors.REQUIREMENTS_INVALID, "amount and asset must use their positive canonical wire forms", "");
    }

    CardanoUtils.ExactCardanoPayload cardanoPayload;
    try {
      cardanoPayload = CardanoUtils.decodePayload(payload.payload());
    } catch (IllegalArgumentException e) {
      return invalid(CardanoErrors.INVALID_PAYLOAD, message(e), "");
    }

    // The confirmation policy always comes from the canonical requirements, never from `accepted`.
    Integer l1Confirmations = CardanoPolicies.l1Confirmations(requirements.extra());
    if (l1Confirmations == null) {
      return invalid(CardanoErrors.POLICY_INVALID, null, "");
    }

    CardanoUtils.UtxoRef nonce;
    try {
      nonce = CardanoUtils.parseUtxoRef(cardanoPayload.nonce());
    } catch (IllegalArgumentException e) {
      return invalid(CardanoErrors.NONCE_INVALID, null, "");
    }

    DecodedCardanoTransaction decoded;
    try {
      decoded = CardanoTransactionDecoder.decode(cardanoPayload.transaction());
    } catch (RuntimeException e) {
      return invalid(CardanoErrors.TRANSACTION_DECODE_FAILED, message(e), "");
    }

    if (decoded.inputs().size() > CardanoConstants.MAX_TRANSACTION_INPUTS) {
      return invalid(
          CardanoErrors.TRANSACTION_PHASE1_INVALID,
          "transaction has " + decoded.inputs().size() + " inputs; verification permits at most "
              + CardanoConstants.MAX_TRANSACTION_INPUTS,
          "");
    }

    // Rule 1: a declared body network id must match; absence is allowed (rule 2 checks the
    // network-tagged address).
    int expectedNetworkId = CardanoNetworks.networkId(requirements.network());
    if (decoded.networkId() != null && decoded.networkId() != expectedNetworkId) {
      return invalid(CardanoErrors.NETWORK_ID_MISMATCH, null, "");
    }
    if (decoded.vkeyWitnessCount() == 0 && decoded.scriptWitnessCount() == 0) {
      return invalid(CardanoErrors.TRANSACTION_UNSIGNED, null, "");
    }
    if (!decoded.signaturesValid()) {
      return invalid(CardanoErrors.INVALID_SIGNATURE, null, "");
    }

    // Rule 5 (input check): unique inputs, nonce among them.
    Set<String> inputSet = new HashSet<>();
    for (String input : decoded.inputs()) {
      inputSet.add(input.toLowerCase(Locale.ROOT));
    }
    if (inputSet.size() != decoded.inputs().size()) {
      return invalid(CardanoErrors.TRANSACTION_PHASE1_INVALID, "transaction contains duplicate inputs", "");
    }
    String nonceRef = nonce.txHash() + "#" + nonce.index();
    if (!inputSet.contains(nonceRef)) {
      return invalid(CardanoErrors.NONCE_NOT_IN_INPUTS, null, "");
    }
    if (!decoded.isValid()) {
      return invalid(CardanoErrors.TRANSACTION_PHASE2_INVALID, null, "");
    }

    // Decision 013 (security divergence from TS, which also accepts any ledger evidence here):
    // only settle's resume of its own retained claim may skip the pre-broadcast checks.
    boolean acceptedByLedger = alreadyBroadcast;

    // Rule 7: TTL bounds through the network's slot configuration.
    if (decoded.ttlSlot() != null || decoded.validityStartSlot() != null) {
      BigInteger currentSlot;
      try {
        currentSlot = BigInteger.valueOf(backend.getCurrentSlot(requirements.network()));
      } catch (RuntimeException e) {
        return invalid(CardanoErrors.CHAIN_LOOKUP_FAILED, message(e), "");
      }
      if (decoded.ttlSlot() != null) {
        if (!acceptedByLedger && decoded.ttlSlot().compareTo(currentSlot) <= 0) {
          return invalid(CardanoErrors.TTL_EXPIRED, null, "");
        }
        BigInteger ttlMs = CardanoNetworks.slotToPosixMs(requirements.network(), decoded.ttlSlot());
        BigInteger latestMs =
            CardanoNetworks.slotToPosixMs(requirements.network(), currentSlot)
                .add(BigInteger.valueOf(requirements.maxTimeoutSeconds()).multiply(BigInteger.valueOf(1000)));
        if (ttlMs.compareTo(latestMs) > 0) {
          return invalid(CardanoErrors.TTL_TOO_FAR, null, "");
        }
      }
      if (decoded.validityStartSlot() != null && decoded.validityStartSlot().compareTo(currentSlot) > 0) {
        return invalid(CardanoErrors.VALIDITY_NOT_YET_VALID, null, "");
      }
    }

    // Rule 5 (on chain): resolve every input.
    List<UtxoSnapshot> inputSnapshots = new ArrayList<>();
    try {
      for (String ref : decoded.inputs()) {
        inputSnapshots.add(backend.getUtxo(ref, requirements.network()));
      }
    } catch (RuntimeException e) {
      return invalid(CardanoErrors.CHAIN_LOOKUP_FAILED, message(e), "");
    }
    UtxoSnapshot nonceSnapshot = null;
    for (int i = 0; i < decoded.inputs().size(); i++) {
      if (decoded.inputs().get(i).toLowerCase(Locale.ROOT).equals(nonceRef)) {
        nonceSnapshot = inputSnapshots.get(i);
        break;
      }
    }
    String payer = nonceSnapshot == null || nonceSnapshot.address() == null ? "" : nonceSnapshot.address();
    if (!acceptedByLedger) {
      if (nonceSnapshot == null || !nonceSnapshot.exists()) {
        return invalid(CardanoErrors.NONCE_NOT_ON_CHAIN, null, payer);
      }
      for (UtxoSnapshot snapshot : inputSnapshots) {
        if (!snapshot.exists()) {
          return invalid(CardanoErrors.INPUT_NOT_AVAILABLE, null, payer);
        }
      }
    }
    if (payer.isEmpty()) {
      return invalid(CardanoErrors.NONCE_NOT_ON_CHAIN, "could not resolve the owner of the nonce UTXO", "");
    }

    ProtocolParameters protocolParameters;
    try {
      protocolParameters = backend.getProtocolParameters(requirements.network());
    } catch (RuntimeException e) {
      return invalid(CardanoErrors.CHAIN_LOOKUP_FAILED, message(e), payer);
    }

    // Rule 6 (phase-1), before the ledger has the transaction.
    if (!acceptedByLedger) {
      Phase1Checks.Result phase1 =
          checkPhase1(cardanoPayload.transaction(), decoded, inputSnapshots, protocolParameters, requirements.network());
      if (!phase1.ok()) {
        return invalid(phase1.reason(), phase1.detail(), payer);
      }
    }

    // Rules 2, 3, 4, 8.
    BigInteger requestedAmount = new BigInteger(requirements.amount());
    String assetKey = requirements.asset().toLowerCase(Locale.ROOT);
    boolean isLovelace = CardanoConstants.LOVELACE.equals(assetKey);
    boolean recipientFound = false;
    boolean assetFoundForRecipient = false;
    BigInteger bestAvailable = BigInteger.ZERO;
    for (DecodedCardanoTransaction.Output output : decoded.outputs()) {
      if (!output.address().equals(requirements.payTo())) {
        continue;
      }
      recipientFound = true;
      BigInteger available = isLovelace ? output.coin() : output.assets().get(assetKey);
      if (available == null) {
        continue;
      }
      assetFoundForRecipient = true;
      if (available.compareTo(bestAvailable) > 0) {
        bestAvailable = available;
      }
      if (available.compareTo(requestedAmount) < 0) {
        continue;
      }
      BigInteger coinsPerUtxoByte = protocolParameters == null ? null : protocolParameters.coinsPerUtxoByte();
      if (coinsPerUtxoByte != null) {
        BigInteger minUtxo = CardanoUtils.minUtxoLovelace(output.serializedSize(), coinsPerUtxoByte);
        if (output.coin().compareTo(minUtxo) < 0) {
          return invalid(
              CardanoErrors.MIN_UTXO_INSUFFICIENT,
              "output to " + requirements.payTo() + " carries " + output.coin() + " lovelace, min-UTXO requires "
                  + minUtxo,
              payer);
        }
      }
      // The method comes from the canonical requirements, never from the client-echoed `accepted`.
      MasumiVerifier.Check methodCheck =
          runMethodSpecificChecks(requirements, decoded, payload, payer, coinsPerUtxoByte);
      if (!methodCheck.ok()) {
        String detail = methodCheck.detail() == null || methodCheck.detail().isEmpty() ? null : methodCheck.detail();
        return invalid(methodCheck.reason(), detail, payer);
      }
      if (!acceptedByLedger) {
        try {
          backend.evaluateTransaction(cardanoPayload.transaction(), requirements.network());
        } catch (RuntimeException e) {
          return invalid(CardanoErrors.CHAIN_LOOKUP_FAILED, message(e), payer);
        }
      }
      if (l1Confirmations > 0 && !canAuthenticateEvidence()) {
        return invalid(
            CardanoErrors.EVIDENCE_UNAVAILABLE,
            "confirmation depth above canonical inclusion requires transaction evidence",
            payer);
      }
      return VerifyResponse.valid(payer);
    }

    if (!recipientFound) {
      return invalid(CardanoErrors.RECIPIENT_MISMATCH, null, payer);
    }
    if (!assetFoundForRecipient) {
      return invalid(CardanoErrors.ASSET_MISMATCH, null, payer);
    }
    return invalid(
        CardanoErrors.AMOUNT_INSUFFICIENT,
        "output to " + requirements.payTo() + " pays " + bestAvailable + ", requires " + requestedAmount,
        payer);
  }

  /**
   * The checks of the transfer method in {@code requirements.extra.assetTransferMethod}:
   * nothing more for {@code default}, the escrow lock for {@code masumi}, the script address for
   * {@code script}.
   *
   * @param requirements the canonical requirements
   * @param decoded the decoded transaction
   * @param payload the payment payload
   * @param payer the nonce owner
   * @param coinsPerUtxoByte live {@code coinsPerUtxoByte}, or {@code null}
   * @return OK or the failure
   */
  protected MasumiVerifier.Check runMethodSpecificChecks(
      PaymentRequirements requirements,
      DecodedCardanoTransaction decoded,
      PaymentPayload payload,
      String payer,
      BigInteger coinsPerUtxoByte) {
    Map<String, Object> extra = requirements.extra();
    Object method = extra.get("assetTransferMethod");
    if (method == null || CardanoConstants.METHOD_DEFAULT.equals(method)) {
      return MasumiVerifier.Check.OK;
    }
    if (CardanoConstants.METHOD_MASUMI.equals(method)) {
      return MasumiVerifier.verifyLock(
          extra,
          requirements,
          decoded,
          new MasumiVerifier.LockContext(
              payer, coinsPerUtxoByte, options.registryValidator(), payload.resource(), options.deploymentValidator()));
    }
    if (CardanoConstants.METHOD_SCRIPT.equals(method)) {
      if (!truthy(extra.get("scriptHash")) && !truthy(extra.get("script"))) {
        return new MasumiVerifier.Check(false, CardanoErrors.SCRIPT_ADDRESS_MISMATCH, null);
      }
      if (!ScriptAddresses.scriptAddressMatches(extra, requirements.payTo())) {
        return new MasumiVerifier.Check(false, CardanoErrors.SCRIPT_ADDRESS_MISMATCH, null);
      }
      return MasumiVerifier.Check.OK;
    }
    return new MasumiVerifier.Check(false, CardanoErrors.UNSUPPORTED_SCHEME, null);
  }

  private static boolean truthy(Object value) {
    return value != null && !Boolean.FALSE.equals(value) && !"".equals(value);
  }

  private Phase1Checks.Result checkPhase1(
      String transaction,
      DecodedCardanoTransaction decoded,
      List<UtxoSnapshot> inputs,
      ProtocolParameters protocolParameters,
      String network) {
    boolean fullValidator = backend.supportsPhase1Validation();
    if (!decoded.balanceChangingOperations().isEmpty()) {
      if (!fullValidator) {
        return new Phase1Checks.Result(
            false,
            CardanoErrors.TRANSACTION_PHASE1_INVALID,
            "transaction carries " + String.join(", ", decoded.balanceChangingOperations())
                + "; without a complete phase-1 validator only plain payments are accepted");
      }
    } else {
      Phase1Checks.Result conserved = Phase1Checks.checkValueConservation(decoded, inputs);
      if (!conserved.ok()) {
        return conserved;
      }
    }
    if (protocolParameters != null) {
      Phase1Checks.Result fee = Phase1Checks.checkMinimumFee(decoded, protocolParameters);
      if (!fee.ok()) {
        return fee;
      }
    }
    if (fullValidator) {
      try {
        backend.validatePhase1Transaction(transaction, network);
      } catch (RuntimeException e) {
        return new Phase1Checks.Result(false, CardanoErrors.TRANSACTION_PHASE1_INVALID, message(e));
      }
    }
    return Phase1Checks.Result.OK;
  }

  // ---------------------------------------------------------------- settle

  /** The decoded payment state settle needs before any chain lookup. */
  private record Resolved(CardanoUtils.ExactCardanoPayload payload, DecodedCardanoTransaction decoded, int required) {}

  private static SettleResponse fail(String reason, String transaction, String message, String network) {
    return SettleResponse.failure(reason, message == null || message.isEmpty() ? null : message, transaction, network);
  }

  /**
   * Settles a payment: claim the canonical transaction id (with the Masumi terms digest), verify,
   * broadcast and wait, bounded, for the policy's evidence. A retry for a transaction already
   * broadcast resumes observing it and never submits again.
   *
   * @param payload the payload
   * @param requirements the requirements
   * @return success, pending or failure
   */
  public final SettleResponse settle(PaymentPayload payload, PaymentRequirements requirements) {
    String network = payload.accepted() == null ? requirements.network() : payload.accepted().network();

    Resolved resolved;
    CardanoUtils.ExactCardanoPayload cardanoPayload;
    try {
      cardanoPayload = CardanoUtils.decodePayload(payload.payload());
    } catch (IllegalArgumentException e) {
      return fail(CardanoErrors.INVALID_PAYLOAD, "", message(e), network);
    }
    DecodedCardanoTransaction decoded;
    try {
      decoded = CardanoTransactionDecoder.decode(cardanoPayload.transaction());
    } catch (RuntimeException e) {
      return fail(CardanoErrors.TRANSACTION_DECODE_FAILED, "", message(e), network);
    }
    Integer required = CardanoPolicies.l1Confirmations(requirements.extra());
    if (required == null) {
      return fail(CardanoErrors.POLICY_INVALID, "", null, network);
    }
    resolved = new Resolved(cardanoPayload, decoded, required);
    String txHash = decoded.txHash();

    // Claim the transaction id and the optional Masumi terms digest atomically, before any
    // chain lookup, so two concurrent calls cannot both reach the node.
    String ownerToken = newOwnerToken();
    SettlementClaimResult claim =
        options
            .settlementStore()
            .claimSettlement(
                new SettlementClaim(
                    txHash, ownerToken, masumiTermsDigest(requirements), retainUntilMs(decoded, requirements.network())));
    switch (claim) {
      case CAPACITY_EXCEEDED:
        return fail(CardanoErrors.SETTLEMENT_FAILED, txHash, "the Cardano settlement store is at capacity", network);
      case TERMS_CONFLICT:
        return fail(
            CardanoErrors.DUPLICATE_SETTLEMENT, txHash, "termsDigest is already bound to another transaction", network);
      case REJECTED:
        return fail(
            CardanoErrors.SETTLEMENT_DEFINITIVELY_REJECTED,
            txHash,
            "this transaction was definitively rejected before ledger acceptance",
            network);
      case IN_FLIGHT:
        return fail(CardanoErrors.DUPLICATE_SETTLEMENT, txHash, null, network);
      case SETTLED:
        return fail(CardanoErrors.DUPLICATE_SETTLEMENT, txHash, "this transaction was already settled", network);
      case SUBMITTED:
        return settledOnce(resume(payload, requirements, resolved, network), txHash, ownerToken, network);
      default:
        return settledOnce(
            settleFresh(payload, requirements, resolved, ownerToken, network), txHash, ownerToken, network);
    }
  }

  /** Decision 013: exactly one success per transaction; every later answer is a duplicate. */
  private SettleResponse settledOnce(SettleResponse response, String txHash, String ownerToken, String network) {
    if (response.success() && !options.settlementStore().markSettled(txHash, ownerToken)) {
      return fail(CardanoErrors.DUPLICATE_SETTLEMENT, txHash, "this transaction was already settled", network);
    }
    return response;
  }

  /** The TTL's POSIX time plus the validity grace, or {@code null} when unknown (decision 126). */
  private static Long retainUntilMs(DecodedCardanoTransaction decoded, String network) {
    if (decoded.ttlSlot() == null) {
      return null;
    }
    try {
      BigInteger until =
          CardanoNetworks.slotToPosixMs(network, decoded.ttlSlot()).add(BigInteger.valueOf(VALIDITY_CLOSE_GRACE_MS));
      return until.min(BigInteger.valueOf(Long.MAX_VALUE)).longValue();
    } catch (RuntimeException e) {
      return null;
    }
  }

  private static String newOwnerToken() {
    byte[] token = new byte[16];
    RANDOM.nextBytes(token);
    return HexFormat.of().formatHex(token);
  }

  /** The pending-settlement retry: this facilitator already broadcast this exact transaction. */
  private SettleResponse resume(
      PaymentPayload payload, PaymentRequirements requirements, Resolved resolved, String network) {
    String txHash = resolved.decoded().txHash();
    VerifyResponse recheck = verifyBroadcast(payload, requirements);
    String payer = recheck.payer() == null ? "" : recheck.payer();
    if (!recheck.isValid()) {
      // A provider outage while re-reading a broadcast transaction is not a verdict on it.
      if (CardanoErrors.CHAIN_LOOKUP_FAILED.equals(recheck.invalidReason())
          || CardanoErrors.NONCE_NOT_ON_CHAIN.equals(recheck.invalidReason())) {
        String detail = recheck.invalidMessage() == null || recheck.invalidMessage().isEmpty()
            ? "" : ": " + recheck.invalidMessage();
        return pendingResponse(
            txHash, network, payer, new LinkedHashMap<>(),
            "the chain lookup failed while resuming a broadcast transaction" + detail);
      }
      return fail(
          recheck.invalidReason() == null ? "verification_failed" : recheck.invalidReason(),
          txHash,
          recheck.invalidMessage(),
          network);
    }
    SettlementEvidence evidence = awaitEvidence(txHash, requirements.network(), resolved.required());
    return evidenceResponse(evidence, network, resolved, payer, true);
  }

  private SettleResponse settleFresh(
      PaymentPayload payload, PaymentRequirements requirements, Resolved resolved, String ownerToken, String network) {
    String txHash = resolved.decoded().txHash();
    // Dispatched through `this` so a subclass that tightens verify() also governs settlement.
    VerifyResponse verifyResult = verifyPayment(payload, requirements);
    if (!verifyResult.isValid()) {
      options.settlementStore().releaseClaim(txHash, ownerToken);
      return fail(
          verifyResult.invalidReason() == null ? "verification_failed" : verifyResult.invalidReason(),
          txHash,
          verifyResult.invalidMessage(),
          network);
    }
    String payer = verifyResult.payer() == null ? "" : verifyResult.payer();
    int required = resolved.required();

    SettlementEvidence.Status submissionStatus;
    try {
      SubmissionResult submission =
          backend.submitTransaction(resolved.payload().transaction(), requirements.network());
      if (submission.txHash() == null || !submission.txHash().equalsIgnoreCase(txHash)) {
        throw new IllegalStateException(
            "submitter returned transaction " + submission.txHash() + ", expected " + txHash);
      }
      submissionStatus = submission.status();
      options.settlementStore().markSubmitted(txHash, ownerToken);
    } catch (RuntimeException cause) {
      // A throw does not prove the transaction never reached the network: ask the ledger.
      boolean landed = false;
      if (canAuthenticateEvidence()) {
        try {
          landed = readEvidence(txHash, requirements.network()).status() != SettlementEvidence.Status.UNKNOWN;
        } catch (RuntimeException e) {
          landed = true;
        }
      }
      if (landed) {
        options.settlementStore().markSubmitted(txHash, ownerToken);
        SettlementEvidence evidence = awaitEvidence(txHash, requirements.network(), required);
        return evidenceResponse(evidence, network, resolved, payer, false);
      }
      boolean definitive = backend.isDefinitiveSubmissionRejection(cause);
      if (definitive) {
        options.settlementStore().markRejected(txHash, ownerToken);
      } else {
        // Unknown does not prove absence: keep the claim so a retry never rebroadcasts.
        options.settlementStore().markSubmitted(txHash, ownerToken);
      }
      return fail(
          definitive ? CardanoErrors.SETTLEMENT_DEFINITIVELY_REJECTED : CardanoErrors.SETTLEMENT_FAILED,
          txHash,
          describeErrorChain(cause),
          network);
    }

    SettlementEvidence evidence;
    if (options.acceptMempool() && required == CardanoConstants.MIN_L1_CONFIRMATIONS) {
      // The node's acceptance is exactly the evidence a -1 policy describes.
      evidence = submitterEvidence(submissionStatus);
    } else if (canAuthenticateEvidence()) {
      evidence = awaitEvidence(txHash, requirements.network(), required);
      if (evidence.status() == SettlementEvidence.Status.UNKNOWN) {
        evidence = new SettlementEvidence(SettlementEvidence.Status.MEMPOOL, CardanoConstants.MIN_L1_CONFIRMATIONS);
      }
    } else {
      evidence = submitterEvidence(submissionStatus);
    }
    return evidenceResponse(evidence, network, resolved, payer, false);
  }

  private static SettlementEvidence submitterEvidence(SettlementEvidence.Status status) {
    return status == SettlementEvidence.Status.CONFIRMED
        ? new SettlementEvidence(SettlementEvidence.Status.CONFIRMED, 0)
        : new SettlementEvidence(SettlementEvidence.Status.MEMPOOL, CardanoConstants.MIN_L1_CONFIRMATIONS);
  }

  private static String describeErrorChain(Throwable error) {
    List<String> parts = new ArrayList<>();
    Throwable current = error;
    for (int depth = 0; current != null && depth < 5; depth++) {
      parts.add(message(current));
      current = current.getCause();
    }
    return String.join(" | ", parts);
  }

  private SettleResponse evidenceResponse(
      SettlementEvidence evidence, String network, Resolved resolved, String payer, boolean resumed) {
    String txHash = resolved.decoded().txHash();
    int required = resolved.required();
    if (evidence.status() == SettlementEvidence.Status.UNKNOWN) {
      if (resumed && validityWindowClosed(resolved.decoded(), network)) {
        Map<String, Object> extra = new LinkedHashMap<>();
        extra.put("status", "expired");
        return new SettleResponse(
            false,
            CardanoErrors.SETTLEMENT_FAILED,
            "the transaction's validity window closed before it was included",
            payer,
            txHash,
            network,
            null,
            null,
            null,
            extra);
      }
      return pendingResponse(txHash, network, payer, new LinkedHashMap<>(), null);
    }
    Map<String, Object> extra = new LinkedHashMap<>();
    extra.put("status", evidence.status().wire());
    extra.put("confirmations", evidence.confirmations());
    if (evidence.status() == SettlementEvidence.Status.MEMPOOL) {
      if (options.acceptMempool() && CardanoPolicies.confirmationsSatisfy(evidence.confirmations(), required)) {
        return new SettleResponse(true, null, null, payer, txHash, network, null, null, null, extra);
      }
      if (canAuthenticateEvidence()) {
        return pendingResponse(txHash, network, payer, extra, null);
      }
      return new SettleResponse(
          false, CardanoErrors.SETTLEMENT_NOT_CONFIRMED, null, payer, txHash, network, null, null, null, extra);
    }
    if (!CardanoPolicies.confirmationsSatisfy(evidence.confirmations(), required)) {
      return pendingResponse(txHash, network, payer, extra, null);
    }
    return new SettleResponse(true, null, null, payer, txHash, network, null, null, null, extra);
  }

  private static SettleResponse pendingResponse(
      String txHash, String network, String payer, Map<String, Object> extra, String errorMessage) {
    Map<String, Object> pendingExtra = new LinkedHashMap<>(extra);
    pendingExtra.put("status", "pending");
    pendingExtra.put("transactionId", txHash);
    return new SettleResponse(
        false,
        CardanoErrors.SETTLEMENT_PENDING,
        errorMessage == null
            ? "the transaction was broadcast and is awaiting the required confirmations"
            : errorMessage,
        payer,
        txHash,
        network,
        null,
        null,
        null,
        pendingExtra);
  }

  private boolean validityWindowClosed(DecodedCardanoTransaction decoded, String network) {
    if (decoded.ttlSlot() == null) {
      return false;
    }
    try {
      BigInteger now = CardanoNetworks.slotToPosixMs(network, BigInteger.valueOf(backend.getCurrentSlot(network)));
      BigInteger closes =
          CardanoNetworks.slotToPosixMs(network, decoded.ttlSlot()).add(BigInteger.valueOf(VALIDITY_CLOSE_GRACE_MS));
      return now.compareTo(closes) > 0;
    } catch (RuntimeException e) {
      return false;
    }
  }

  /**
   * Polls evidence until the threshold is met or the confirmation timeout elapses. Elapsed time
   * is the larger of the clock's progress and the time slept, so a fixed test clock cannot make
   * the loop spin (decision 047).
   */
  private SettlementEvidence awaitEvidence(String txHash, String network, int required) {
    SettlementEvidence latest = new SettlementEvidence(SettlementEvidence.Status.UNKNOWN, CardanoConstants.MIN_L1_CONFIRMATIONS - 1);
    if (!canAuthenticateEvidence()) {
      return latest;
    }
    long start = options.clock().millis();
    long timeout = options.confirmationTimeout().toMillis();
    long poll = Math.max(1, options.confirmationPoll().toMillis());
    long slept = 0;
    while (true) {
      try {
        latest = readEvidence(txHash, network);
      } catch (RuntimeException e) {
        // Keep the strongest result seen so far and retry until the deadline.
      }
      if (latest.status() != SettlementEvidence.Status.UNKNOWN
          && CardanoPolicies.confirmationsSatisfy(latest.confirmations(), required)) {
        return latest;
      }
      long elapsed = Math.max(options.clock().millis() - start, slept);
      if (elapsed + poll >= timeout) {
        return latest;
      }
      try {
        Thread.sleep(poll);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return latest;
      }
      slept += poll;
    }
  }

  /** The Masumi terms digest of the requirements, when it is a schema-valid Masumi payment. */
  private static String masumiTermsDigest(PaymentRequirements requirements) {
    if (!CardanoConstants.METHOD_MASUMI.equals(requirements.extra().get("assetTransferMethod"))) {
      return null;
    }
    MasumiSchema.Result schema = MasumiSchema.validate(requirements.extra(), requirements.network());
    return schema.ok()
        ? MasumiDigests.computeTermsDigest(MasumiDigests.buildSignedTerms(schema.extra(), requirements))
        : null;
  }
}
