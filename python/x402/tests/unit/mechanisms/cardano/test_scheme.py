"""Unit tests for the Cardano exact scheme classes."""

from __future__ import annotations

from typing import Any

import pytest

from x402.mechanisms.cardano import (
    CARDANO_MAINNET_CAIP2,
    CARDANO_PREPROD_CAIP2,
    CARDANO_PREVIEW_CAIP2,
    USDM_MAINNET_ASSET,
    USDM_PREPROD_ASSET,
    CardanoSubmissionResult,
    CardanoUtxoSnapshot,
)
from x402.mechanisms.cardano.exact import (
    ExactCardanoClientScheme,
    ExactCardanoFacilitatorScheme,
    ExactCardanoServerScheme,
)
from x402.schemas import (
    AssetAmount,
    PaymentPayload,
    PaymentRequirements,
    SupportedKind,
)

TX_HASH = "a" * 64
RECIPIENT = "addr1qxytestrecipientaddress00"


def make_requirements(**overrides: Any) -> PaymentRequirements:
    """Build payment requirements with sensible Cardano defaults.

    Args:
        **overrides: Field overrides.

    Returns:
        Payment requirements ready for tests.
    """
    fields: dict[str, Any] = {
        "scheme": "exact",
        "network": CARDANO_MAINNET_CAIP2,
        "asset": USDM_MAINNET_ASSET,
        "amount": "10000",
        "pay_to": RECIPIENT,
        "max_timeout_seconds": 600,
        "extra": {},
    }
    fields.update(overrides)
    return PaymentRequirements(**fields)


class StubClientSigner:
    """Stub Cardano client signer for unit tests."""

    def get_address(self) -> str:
        return "addr1qxsomeaddress00"

    def sign_payment_transaction(self, **_: Any) -> dict[str, str]:
        return {"transaction": "AAAA", "nonce": f"{TX_HASH}#0"}


class StubFacilitatorSigner:
    """Stub Cardano facilitator signer for unit tests."""

    def __init__(self, *, exists: bool = True, address: str = "addr1qpayer00",
                 current_slot: int = 100, status: str = "confirmed"):
        self._exists = exists
        self._address = address
        self._current_slot = current_slot
        self._status = status
        self.submitted: list[str] = []

    def get_addresses(self) -> list[str]:
        return ["addr1qfacilitator00"]

    def get_utxo(self, ref: str, network: str) -> CardanoUtxoSnapshot:
        return CardanoUtxoSnapshot(exists=self._exists, address=self._address)

    def get_current_slot(self, network: str) -> int:
        return self._current_slot

    def submit_transaction(
        self, signed_transaction_base64: str, network: str
    ) -> CardanoSubmissionResult:
        self.submitted.append(signed_transaction_base64)
        return CardanoSubmissionResult(tx_hash="deadbeef", status=self._status)


# =============================================================================
# Client tests
# =============================================================================


def test_client_rejects_non_cardano_network():
    client = ExactCardanoClientScheme(StubClientSigner())
    with pytest.raises(ValueError, match="Unsupported Cardano network"):
        client.create_payment_payload(make_requirements(network="ethereum:1"))


def test_client_rejects_invalid_address():
    client = ExactCardanoClientScheme(StubClientSigner())
    with pytest.raises(ValueError, match="Invalid Cardano pay-to address"):
        client.create_payment_payload(make_requirements(pay_to="0xnope"))


def test_client_rejects_invalid_asset():
    client = ExactCardanoClientScheme(StubClientSigner())
    with pytest.raises(ValueError, match="Invalid Cardano asset unit"):
        client.create_payment_payload(make_requirements(asset="not.a.unit"))


def test_client_rejects_non_integer_amount():
    client = ExactCardanoClientScheme(StubClientSigner())
    with pytest.raises(ValueError, match="Amount must be a non-negative integer"):
        client.create_payment_payload(make_requirements(amount="10.5"))


def test_client_returns_signed_payload_for_valid_inputs():
    client = ExactCardanoClientScheme(StubClientSigner())
    payload = client.create_payment_payload(make_requirements())
    assert payload == {"transaction": "AAAA", "nonce": f"{TX_HASH}#0"}


def test_client_rejects_invalid_signer_response():
    class BadSigner:
        def get_address(self) -> str:
            return "addr1q"

        def sign_payment_transaction(self, **_: Any) -> dict[str, str]:
            return {"transaction": "AAAA", "nonce": "bad"}

    client = ExactCardanoClientScheme(BadSigner())
    with pytest.raises(RuntimeError, match="invalid nonce"):
        client.create_payment_payload(make_requirements())


# =============================================================================
# Facilitator tests
# =============================================================================


def test_facilitator_declares_caip_family():
    facilitator = ExactCardanoFacilitatorScheme(StubFacilitatorSigner())
    assert facilitator.scheme == "exact"
    assert facilitator.caip_family == "cardano:*"


def test_facilitator_get_signers():
    facilitator = ExactCardanoFacilitatorScheme(StubFacilitatorSigner())
    assert facilitator.get_signers(CARDANO_MAINNET_CAIP2) == ["addr1qfacilitator00"]


def test_facilitator_get_extra_returns_none():
    facilitator = ExactCardanoFacilitatorScheme(StubFacilitatorSigner())
    assert facilitator.get_extra(CARDANO_PREPROD_CAIP2) is None


def test_facilitator_rejects_network_mismatch():
    facilitator = ExactCardanoFacilitatorScheme(StubFacilitatorSigner())
    payload = PaymentPayload(
        x402_version=2,
        accepted=make_requirements(network=CARDANO_PREVIEW_CAIP2),
        payload={"transaction": "AA", "nonce": f"{TX_HASH}#0"},
    )
    response = facilitator.verify(payload, make_requirements())
    assert response.is_valid is False
    assert response.invalid_reason == "network_mismatch"


def test_facilitator_rejects_non_cardano_network():
    facilitator = ExactCardanoFacilitatorScheme(StubFacilitatorSigner())
    reqs = make_requirements(network="ethereum:1")
    payload = PaymentPayload(
        x402_version=2,
        accepted=reqs,
        payload={"transaction": "AA", "nonce": f"{TX_HASH}#0"},
    )
    response = facilitator.verify(payload, reqs)
    assert response.is_valid is False
    assert response.invalid_reason == "network_mismatch"


def test_facilitator_rejects_invalid_payload():
    facilitator = ExactCardanoFacilitatorScheme(StubFacilitatorSigner())
    payload = PaymentPayload(
        x402_version=2,
        accepted=make_requirements(),
        payload={"nonce": f"{TX_HASH}#0"},  # missing transaction
    )
    response = facilitator.verify(payload, make_requirements())
    assert response.is_valid is False
    assert response.invalid_reason == "invalid_exact_cardano_payload"


def test_facilitator_rejects_invalid_nonce():
    facilitator = ExactCardanoFacilitatorScheme(StubFacilitatorSigner())
    payload = PaymentPayload(
        x402_version=2,
        accepted=make_requirements(),
        payload={"transaction": "AA", "nonce": "bad"},
    )
    response = facilitator.verify(payload, make_requirements())
    assert response.is_valid is False
    assert response.invalid_reason == "invalid_exact_cardano_payload_nonce_invalid"


def test_facilitator_rejects_script_method_in_base_class():
    """Base class refuses script payments because it cannot reconstruct the
    script address. Integrators must override `_run_method_specific_checks`.
    """
    facilitator = ExactCardanoFacilitatorScheme(StubFacilitatorSigner())
    ok, reason = facilitator._run_method_specific_checks(
        {"assetTransferMethod": "script", "scriptHash": "deadbeef"},
        RECIPIENT,
        "addr1qpayer00",
    )
    assert ok is False
    assert reason == "invalid_exact_cardano_payload_script_address_mismatch"


def test_facilitator_settle_rejects_mempool_when_not_accepted():
    """Default settle() refuses mempool-only inclusion."""

    class _Facilitator(ExactCardanoFacilitatorScheme):
        def verify(self, payload, requirements, context=None):
            from x402.schemas import VerifyResponse

            return VerifyResponse(is_valid=True, payer="addr1qpayer00")

    signer = StubFacilitatorSigner(status="mempool")
    facilitator = _Facilitator(signer)
    payload = PaymentPayload(
        x402_version=2,
        accepted=make_requirements(),
        payload={"transaction": "AAAA", "nonce": f"{TX_HASH}#0"},
    )
    response = facilitator.settle(payload, make_requirements())
    assert response.success is False
    assert response.error_reason == "exact_cardano_settlement_not_confirmed"
    assert response.transaction == "deadbeef"


def test_facilitator_reads_method_from_canonical_requirements_extra(monkeypatch):
    """Script-mode rejection must use the canonical server-side requirements
    extra, not the client-echoed `payload.accepted.extra`.
    """
    captured: dict[str, dict[str, Any] | None] = {}

    class _Facilitator(ExactCardanoFacilitatorScheme):
        def _run_method_specific_checks(self, extra, pay_to, payer):
            captured["extra"] = dict(extra) if extra else None
            return True, ""

    facilitator = _Facilitator(StubFacilitatorSigner())

    # Stub the CSL-bound transaction decode so the test runs without pycardano.
    from x402.mechanisms.cardano.types import (
        CardanoUtxoOutput,
        DecodedCardanoTransaction,
    )

    decoded = DecodedCardanoTransaction(
        tx_hash="abc",
        network_id=1,
        ttl_slot=None,
        validity_start_slot=None,
        inputs=[f"{TX_HASH}#0"],
        outputs=[
            CardanoUtxoOutput(
                address=RECIPIENT,
                coin=0,
                assets={USDM_MAINNET_ASSET.lower(): 10_000},
            )
        ],
        vkey_witness_count=1,
        script_witness_count=0,
    )
    monkeypatch.setattr(
        "x402.mechanisms.cardano.exact.facilitator.decode_cardano_transaction",
        lambda _: decoded,
    )

    server_requirements = make_requirements(
        extra={"assetTransferMethod": "script", "scriptHash": "deadbeef"},
    )
    # Client echoes back a benign-looking 'default' to try to bypass.
    payload = PaymentPayload(
        x402_version=2,
        accepted=make_requirements(extra={"assetTransferMethod": "default"}),
        payload={"transaction": "AAAA", "nonce": f"{TX_HASH}#0"},
    )

    facilitator.verify(payload, server_requirements)
    assert captured["extra"] == {
        "assetTransferMethod": "script",
        "scriptHash": "deadbeef",
    }


def test_facilitator_rejects_unsigned_transactions(monkeypatch):
    """Verify must reject transactions with no witnesses (unsigned)."""
    facilitator = ExactCardanoFacilitatorScheme(StubFacilitatorSigner())

    from x402.mechanisms.cardano.types import (
        CardanoUtxoOutput,
        DecodedCardanoTransaction,
    )

    decoded = DecodedCardanoTransaction(
        tx_hash="abc",
        network_id=1,
        ttl_slot=None,
        validity_start_slot=None,
        inputs=[f"{TX_HASH}#0"],
        outputs=[
            CardanoUtxoOutput(
                address=RECIPIENT,
                coin=0,
                assets={USDM_MAINNET_ASSET.lower(): 10_000},
            )
        ],
        vkey_witness_count=0,  # unsigned!
        script_witness_count=0,
    )
    monkeypatch.setattr(
        "x402.mechanisms.cardano.exact.facilitator.decode_cardano_transaction",
        lambda _: decoded,
    )
    payload = PaymentPayload(
        x402_version=2,
        accepted=make_requirements(),
        payload={"transaction": "AAAA", "nonce": f"{TX_HASH}#0"},
    )
    response = facilitator.verify(payload, make_requirements())
    assert response.is_valid is False
    assert response.invalid_reason == "invalid_exact_cardano_payload_unsigned"


def test_facilitator_concurrent_settle_blocked_by_claim():
    """A second concurrent settle() must be rejected as duplicate even before
    the first submit_transaction returns.
    """

    class _Facilitator(ExactCardanoFacilitatorScheme):
        def verify(self, payload, requirements, context=None):
            from x402.schemas import VerifyResponse

            return VerifyResponse(is_valid=True, payer="addr1qpayer00")

    facilitator = _Facilitator(StubFacilitatorSigner())
    payload = PaymentPayload(
        x402_version=2,
        accepted=make_requirements(),
        payload={"transaction": "AAAA", "nonce": f"{TX_HASH}#0"},
    )
    first = facilitator.settle(payload, make_requirements())
    second = facilitator.settle(payload, make_requirements())
    assert first.success is True
    assert second.success is False
    assert second.error_reason == "duplicate_settlement"


def test_facilitator_settle_accepts_mempool_when_enabled():
    class _Facilitator(ExactCardanoFacilitatorScheme):
        def verify(self, payload, requirements, context=None):
            from x402.schemas import VerifyResponse

            return VerifyResponse(is_valid=True, payer="addr1qpayer00")

    signer = StubFacilitatorSigner(status="mempool")
    facilitator = _Facilitator(signer, accept_mempool=True)
    payload = PaymentPayload(
        x402_version=2,
        accepted=make_requirements(),
        payload={"transaction": "AAAA", "nonce": f"{TX_HASH}#0"},
    )
    response = facilitator.settle(payload, make_requirements())
    assert response.success is True
    assert response.transaction == "deadbeef"


# =============================================================================
# Server tests
# =============================================================================


def test_server_parses_money_strings_to_usdm_atomic_units():
    server = ExactCardanoServerScheme()
    result = server.parse_price("$1.50", CARDANO_MAINNET_CAIP2)
    assert result.amount == "1500000"
    assert result.asset == USDM_MAINNET_ASSET


def test_server_passes_through_asset_amount_dict():
    server = ExactCardanoServerScheme()
    result = server.parse_price(
        {"amount": "12345", "asset": USDM_PREPROD_ASSET, "extra": {"tier": "premium"}},
        CARDANO_PREPROD_CAIP2,
    )
    assert result.amount == "12345"
    assert result.extra == {"tier": "premium"}


def test_server_money_parser_chain():
    server = ExactCardanoServerScheme()

    def vip(amount: float, _network: str):
        if amount > 100:
            return AssetAmount(
                amount=str(int(amount * 1_000_000)),
                asset=USDM_MAINNET_ASSET,
                extra={"tier": "vip"},
            )
        return None

    server.register_money_parser(vip)

    big = server.parse_price("150", CARDANO_MAINNET_CAIP2)
    assert big.extra == {"tier": "vip"}
    small = server.parse_price("1", CARDANO_MAINNET_CAIP2)
    assert small.amount == "1000000"
    assert small.extra == {}


def test_server_enhance_payment_requirements_merges_extras():
    server = ExactCardanoServerScheme()
    base = make_requirements(extra={"foo": "bar"})
    supported = SupportedKind(
        x402_version=2,
        scheme="exact",
        network=CARDANO_MAINNET_CAIP2,
        extra={"policy": "default"},
    )
    enhanced = server.enhance_payment_requirements(base, supported, [])
    assert enhanced.extra == {"policy": "default", "foo": "bar"}


def test_server_rejects_non_cardano_network_in_enhance():
    server = ExactCardanoServerScheme()
    base = make_requirements()
    supported = SupportedKind(
        x402_version=2, scheme="exact", network="ethereum:1", extra={}
    )
    with pytest.raises(ValueError, match="Unsupported Cardano network"):
        server.enhance_payment_requirements(base, supported, [])
