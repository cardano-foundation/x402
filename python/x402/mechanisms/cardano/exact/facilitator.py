"""Cardano facilitator implementation for the Exact payment scheme (V2)."""

from __future__ import annotations

import threading
import time
from typing import Any

from ....schemas import (
    Network,
    PaymentPayload,
    PaymentRequirements,
    SettleResponse,
    VerifyResponse,
)
from ..constants import (
    ASSET_TRANSFER_METHOD_DEFAULT,
    ASSET_TRANSFER_METHOD_MASUMI,
    ASSET_TRANSFER_METHOD_SCRIPT,
    ERR_AMOUNT_INSUFFICIENT,
    ERR_ASSET_MISMATCH,
    ERR_CHAIN_LOOKUP_FAILED,
    ERR_DUPLICATE_SETTLEMENT,
    ERR_INVALID_PAYLOAD,
    ERR_NETWORK_ID_MISMATCH,
    ERR_NETWORK_MISMATCH,
    ERR_NONCE_INVALID,
    ERR_NONCE_NOT_IN_INPUTS,
    ERR_NONCE_NOT_ON_CHAIN,
    ERR_RECIPIENT_MISMATCH,
    ERR_SCRIPT_ADDRESS_MISMATCH,
    ERR_SETTLEMENT_FAILED,
    ERR_SETTLEMENT_NOT_CONFIRMED,
    ERR_TRANSACTION_DECODE_FAILED,
    ERR_TRANSACTION_UNSIGNED,
    ERR_TTL_EXPIRED,
    ERR_UNSUPPORTED_SCHEME,
    ERR_VALIDITY_NOT_YET_VALID,
    SCHEME_EXACT,
    SETTLEMENT_TTL_SECONDS,
    get_cardano_network_id,
    is_cardano_network,
)
from ..signer import FacilitatorCardanoSigner
from ..types import (
    CardanoUtxoSnapshot,
    DecodedCardanoTransaction,
    ExactCardanoPayload,
)
from ..utils import (
    CardanoSdkMissingError,
    decode_cardano_payload,
    decode_cardano_transaction,
    parse_utxo_ref,
)


class ExactCardanoScheme:
    """Cardano facilitator implementation for the Exact payment scheme (V2).

    Verifies and settles Cardano native-token payments per the spec's six
    facilitator verification rules.

    Attributes:
        scheme: Scheme identifier ("exact").
        caip_family: CAIP family pattern ("cardano:*").
    """

    scheme = SCHEME_EXACT
    caip_family = "cardano:*"

    def __init__(
        self,
        signer: FacilitatorCardanoSigner,
        *,
        accept_mempool: bool = False,
        duplicate_cache_ttl_seconds: float = SETTLEMENT_TTL_SECONDS,
    ) -> None:
        """Create the facilitator scheme.

        Args:
            signer: Chain query / submission implementation.
            accept_mempool: When True, settlement is considered successful
                even if the signer reports `mempool` only. Defaults to False.
            duplicate_cache_ttl_seconds: Lifetime of the duplicate-settlement
                cache. Defaults to two minutes.
        """
        self._signer = signer
        self._accept_mempool = accept_mempool
        self._duplicate_cache_ttl = duplicate_cache_ttl_seconds
        self._settlement_cache: dict[str, float] = {}
        # Lock guards _try_claim/_release_claim against concurrent sync calls.
        self._cache_lock = threading.Lock()

    # ------------------------------------------------------------------ #
    # Mechanism protocol
    # ------------------------------------------------------------------ #

    def get_extra(self, network: Network) -> dict[str, Any] | None:
        """Return mechanism-specific extra metadata for `/supported`.

        The default Cardano scheme has no required metadata; subclasses can
        override.

        Args:
            network: The Cardano network identifier (unused).

        Returns:
            Always None.
        """
        _ = network
        return None

    def get_signers(self, network: Network) -> list[str]:
        """Return facilitator addresses for the supplied network.

        Args:
            network: Cardano network identifier (unused).

        Returns:
            List of bech32 facilitator addresses.
        """
        _ = network
        return list(self._signer.get_addresses())

    def verify(
        self,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
        context: Any | None = None,
    ) -> VerifyResponse:
        """Verify a Cardano payment per the spec's six rules.

        Args:
            payload: Payment payload from the client.
            requirements: Payment requirements being fulfilled.
            context: Optional facilitator context (unused).

        Returns:
            A VerifyResponse describing success or failure.
        """
        _ = context
        if payload.x402_version != 2:
            return VerifyResponse(
                is_valid=False,
                invalid_reason=f"{ERR_INVALID_PAYLOAD}_unsupported_version",
                payer="",
            )

        if (
            payload.accepted.scheme != SCHEME_EXACT
            or requirements.scheme != SCHEME_EXACT
        ):
            return VerifyResponse(
                is_valid=False, invalid_reason=ERR_UNSUPPORTED_SCHEME, payer=""
            )

        accepted_network = str(payload.accepted.network)
        required_network = str(requirements.network)
        if accepted_network != required_network:
            return VerifyResponse(
                is_valid=False, invalid_reason=ERR_NETWORK_MISMATCH, payer=""
            )
        if not is_cardano_network(required_network):
            return VerifyResponse(
                is_valid=False, invalid_reason=ERR_NETWORK_MISMATCH, payer=""
            )

        try:
            cardano_payload = decode_cardano_payload(payload.payload)
        except Exception:
            return VerifyResponse(
                is_valid=False, invalid_reason=ERR_INVALID_PAYLOAD, payer=""
            )

        try:
            tx_hash, index = parse_utxo_ref(cardano_payload.nonce)
        except ValueError:
            return VerifyResponse(
                is_valid=False, invalid_reason=ERR_NONCE_INVALID, payer=""
            )
        nonce_lower = f"{tx_hash}#{index}"

        try:
            decoded: DecodedCardanoTransaction = decode_cardano_transaction(
                cardano_payload.transaction
            )
        except CardanoSdkMissingError as exc:
            # Missing optional SDK is a facilitator misconfiguration, not a
            # client error.
            return VerifyResponse(
                is_valid=False,
                invalid_reason=ERR_CHAIN_LOOKUP_FAILED,
                invalid_message=str(exc),
                payer="",
            )
        except Exception as exc:
            return VerifyResponse(
                is_valid=False,
                invalid_reason=ERR_TRANSACTION_DECODE_FAILED,
                invalid_message=str(exc),
                payer="",
            )

        # Rule 1: When the transaction body declares a network_id it MUST match
        # the declared network. Absence is permitted: the field is optional in
        # the Cardano CBOR spec and many wallets omit it. Network correctness is
        # still enforced by Rule 3 (payTo address check): Cardano addresses are
        # network-tagged (addr_test1... vs addr1...), so a testnet address
        # cannot be submitted on mainnet and vice versa.
        expected_network_id = get_cardano_network_id(required_network)
        if decoded.network_id is not None and decoded.network_id != expected_network_id:
            return VerifyResponse(
                is_valid=False, invalid_reason=ERR_NETWORK_ID_MISMATCH, payer=""
            )

        # SECURITY: refuse unsigned transactions in verify() so /verify cannot
        # return a false-positive that would let callers grant access on an
        # unpaid request. Submission would also fail, but the spec's verify()
        # is supposed to detect this up front.
        if decoded.vkey_witness_count == 0 and decoded.script_witness_count == 0:
            return VerifyResponse(
                is_valid=False, invalid_reason=ERR_TRANSACTION_UNSIGNED, payer=""
            )

        # Rule 6 (and lower-bound): TTL must not be in the past, AND any
        # validity-start (lower bound) must already have arrived. Both checks
        # need the current slot, so do a single lookup when either bound is
        # present.
        if decoded.ttl_slot is not None or decoded.validity_start_slot is not None:
            try:
                current_slot = int(self._signer.get_current_slot(required_network))
            except Exception as exc:
                return VerifyResponse(
                    is_valid=False,
                    invalid_reason=ERR_CHAIN_LOOKUP_FAILED,
                    invalid_message=str(exc),
                    payer="",
                )
            if decoded.ttl_slot is not None and decoded.ttl_slot <= current_slot:
                return VerifyResponse(
                    is_valid=False, invalid_reason=ERR_TTL_EXPIRED, payer=""
                )
            if (
                decoded.validity_start_slot is not None
                and decoded.validity_start_slot > current_slot
            ):
                return VerifyResponse(
                    is_valid=False, invalid_reason=ERR_VALIDITY_NOT_YET_VALID, payer=""
                )

        # Rule 5 (input check): nonce UTXO must appear as an input.
        input_set = {i.lower() for i in decoded.inputs}
        if nonce_lower not in input_set:
            return VerifyResponse(
                is_valid=False, invalid_reason=ERR_NONCE_NOT_IN_INPUTS, payer=""
            )

        # Rule 5 (chain check): nonce UTXO must currently be unspent.
        try:
            snapshot: CardanoUtxoSnapshot = self._signer.get_utxo(
                nonce_lower, required_network
            )
        except Exception as exc:
            return VerifyResponse(
                is_valid=False,
                invalid_reason=ERR_CHAIN_LOOKUP_FAILED,
                invalid_message=str(exc),
                payer="",
            )
        if not snapshot.exists:
            return VerifyResponse(
                is_valid=False, invalid_reason=ERR_NONCE_NOT_ON_CHAIN, payer=""
            )

        payer = snapshot.address or ""

        # Rules 2, 3, 4: at least one output must pay enough of the right
        # asset to the right address. Lovelace is special-cased: native ADA
        # lives in the output's `coin` field rather than the multi-asset map.
        required_amount = int(requirements.amount)
        asset_key = requirements.asset.lower()
        is_lovelace = asset_key == "lovelace"
        recipient_seen = False
        asset_seen_for_recipient = False

        for output in decoded.outputs:
            if output.address != requirements.pay_to:
                continue
            recipient_seen = True
            if is_lovelace:
                available: int | None = output.coin
            else:
                available = output.assets.get(asset_key)
            if available is None:
                continue
            asset_seen_for_recipient = True
            if available >= required_amount:
                # SECURITY: Read assetTransferMethod from the canonical
                # server-supplied requirements, NOT from payload.accepted.extra
                # (which is client-echoed and could lie about the method to
                # bypass script-mode checks).
                method_check = self._run_method_specific_checks(
                    requirements.extra, requirements.pay_to, payer
                )
                if not method_check[0]:
                    return VerifyResponse(
                        is_valid=False, invalid_reason=method_check[1], payer=payer
                    )
                # Optional cryptographic authorization check via a Cardano
                # node dry-run. Skipped when the signer does not implement
                # `evaluate_transaction`; in that case verify() is best-effort
                # and settle() will still surface signature errors at submit.
                evaluate = getattr(self._signer, "evaluate_transaction", None)
                if callable(evaluate):
                    try:
                        evaluate(cardano_payload.transaction, required_network)
                    except Exception as exc:
                        return VerifyResponse(
                            is_valid=False,
                            invalid_reason=ERR_CHAIN_LOOKUP_FAILED,
                            invalid_message=str(exc),
                            payer=payer,
                        )
                return VerifyResponse(is_valid=True, payer=payer)

        if not recipient_seen:
            return VerifyResponse(
                is_valid=False, invalid_reason=ERR_RECIPIENT_MISMATCH, payer=payer
            )
        if not asset_seen_for_recipient:
            return VerifyResponse(
                is_valid=False, invalid_reason=ERR_ASSET_MISMATCH, payer=payer
            )
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_AMOUNT_INSUFFICIENT, payer=payer
        )

    def settle(
        self,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
        context: Any | None = None,
    ) -> SettleResponse:
        """Settle a Cardano payment by re-verifying and submitting.

        Args:
            payload: The payment payload to settle.
            requirements: Payment requirements.
            context: Optional facilitator context (unused).

        Returns:
            A SettleResponse describing success or failure.
        """
        verify_result = self.verify(payload, requirements, context)
        if not verify_result.is_valid:
            return SettleResponse(
                success=False,
                error_reason=verify_result.invalid_reason or "verification_failed",
                transaction="",
                network=str(payload.accepted.network),
            )

        cardano_payload = ExactCardanoPayload.from_dict(payload.payload)
        cache_key = cardano_payload.transaction
        # Atomically claim the cache key BEFORE submission so concurrent
        # settle() calls cannot race past the duplicate check.
        if not self._try_claim(cache_key):
            return SettleResponse(
                success=False,
                error_reason=ERR_DUPLICATE_SETTLEMENT,
                transaction="",
                network=str(payload.accepted.network),
            )

        try:
            submission = self._signer.submit_transaction(
                cardano_payload.transaction, str(requirements.network)
            )
        except Exception:
            # Submission threw — release the claim so the caller can retry
            # with a corrected payload.
            self._release_claim(cache_key)
            return SettleResponse(
                success=False,
                error_reason=ERR_SETTLEMENT_FAILED,
                transaction="",
                network=str(payload.accepted.network),
            )

        if submission.status != "confirmed" and not self._accept_mempool:
            # Spec: granting access on mempool inclusion is strongly
            # discouraged because Cardano has probabilistic finality. Keep the
            # claim in place even on rejection so retries cannot rebroadcast
            # the same transaction repeatedly.
            return SettleResponse(
                success=False,
                error_reason=ERR_SETTLEMENT_NOT_CONFIRMED,
                transaction=submission.tx_hash,
                network=str(payload.accepted.network),
                extensions={"status": submission.status},
            )

        return SettleResponse(
            success=True,
            transaction=submission.tx_hash,
            network=str(payload.accepted.network),
            extensions={"status": submission.status},
        )

    # ------------------------------------------------------------------ #
    # Hooks
    # ------------------------------------------------------------------ #

    def _run_method_specific_checks(
        self,
        extra: dict[str, Any] | None,
        pay_to: str,
        payer: str,
    ) -> tuple[bool, str]:
        """Verify the assetTransferMethod-specific extras.

        Args:
            extra: The accepted requirements' extra block.
            pay_to: The recipient address declared in the payment requirements.
            payer: The payer address (passed through for context).

        Returns:
            Tuple `(ok, reason_or_empty)`. When `ok` is False, `reason` is the
            invalid_reason to return to callers.
        """
        _ = pay_to, payer
        method = (extra or {}).get("assetTransferMethod") or ASSET_TRANSFER_METHOD_DEFAULT
        if method in (ASSET_TRANSFER_METHOD_DEFAULT, ASSET_TRANSFER_METHOD_MASUMI):
            return True, ""
        if method == ASSET_TRANSFER_METHOD_SCRIPT:
            extra_d = extra or {}
            if "scriptHash" not in extra_d and "script" not in extra_d:
                return False, ERR_SCRIPT_ADDRESS_MISMATCH
            # SECURITY: per the spec, the facilitator must reconstruct the
            # script address from script + parameters and verify it equals
            # `pay_to`. The base class cannot perform this without an SDK,
            # so we reject by default and require integrators to override.
            return False, ERR_SCRIPT_ADDRESS_MISMATCH
        return False, ERR_UNSUPPORTED_SCHEME

    def _try_claim(self, key: str) -> bool:
        """Atomically claim a cache key for an in-flight settlement.

        Held under a lock so concurrent threaded settle() calls cannot both
        pass the duplicate check before the first submission returns.

        Args:
            key: Cache key (typically the base64 transaction).

        Returns:
            True when the claim was acquired; False when the key was already
            claimed within the duplicate-settlement window.
        """
        with self._cache_lock:
            seen_at = self._settlement_cache.get(key)
            now = time.time()
            if seen_at is not None and now - seen_at <= self._duplicate_cache_ttl:
                return False
            self._settlement_cache[key] = now
            if len(self._settlement_cache) > 1024:
                cutoff = now - self._duplicate_cache_ttl
                self._settlement_cache = {
                    k: t for k, t in self._settlement_cache.items() if t >= cutoff
                }
            return True

    def _release_claim(self, key: str) -> None:
        """Release a previously-claimed cache key so retries can attempt
        settlement again. Called when submission throws a transient error.

        Args:
            key: Cache key (typically the base64 transaction).
        """
        with self._cache_lock:
            self._settlement_cache.pop(key, None)
