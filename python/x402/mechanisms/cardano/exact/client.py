"""Cardano client implementation for the Exact payment scheme (V2)."""

from __future__ import annotations

import re
from typing import Any

from ....schemas import PaymentRequirements
from ..constants import (
    CARDANO_ADDRESS_REGEX,
    CARDANO_ASSET_REGEX,
    CARDANO_UTXO_REF_REGEX,
    SCHEME_EXACT,
    is_cardano_network,
)
from ..signer import ClientCardanoSigner
from ..types import ExactCardanoPayload

_ADDRESS_RE = re.compile(CARDANO_ADDRESS_REGEX)
_ASSET_RE = re.compile(CARDANO_ASSET_REGEX)
_UTXO_RE = re.compile(CARDANO_UTXO_REF_REGEX)
_AMOUNT_RE = re.compile(r"^[0-9]+$")


class ExactCardanoScheme:
    """Cardano client implementation for the Exact payment scheme (V2).

    Implements `SchemeNetworkClient`. Returns the inner payload dict, which
    `x402Client` wraps into a full PaymentPayload.

    Attributes:
        scheme: The scheme identifier ("exact").
    """

    scheme = SCHEME_EXACT

    def __init__(self, signer: ClientCardanoSigner) -> None:
        """Create the Cardano client scheme.

        Args:
            signer: A signer that produces base64-encoded signed transactions
                and the UTXO reference used as nonce.
        """
        self._signer = signer

    def create_payment_payload(self, requirements: PaymentRequirements) -> dict[str, Any]:
        """Build a Cardano payment payload via the configured signer.

        Args:
            requirements: The x402 payment requirements to fulfill.

        Returns:
            The inner payload dict (`{transaction, nonce}`).

        Raises:
            ValueError: If requirements are invalid for Cardano.
            RuntimeError: If the signer returns an invalid response.
        """
        network = str(requirements.network)
        if not is_cardano_network(network):
            raise ValueError(f"Unsupported Cardano network: {network}")
        if not requirements.pay_to:
            raise ValueError("Pay-to address is required")
        if not _ADDRESS_RE.match(requirements.pay_to):
            raise ValueError(f"Invalid Cardano pay-to address: {requirements.pay_to}")
        if not requirements.asset:
            raise ValueError("Asset is required")
        if not _ASSET_RE.match(requirements.asset):
            raise ValueError(f"Invalid Cardano asset unit: {requirements.asset}")
        if not requirements.amount:
            raise ValueError("Amount is required")
        if not _AMOUNT_RE.match(requirements.amount):
            raise ValueError(f"Amount must be a non-negative integer, got: {requirements.amount}")

        result = self._signer.sign_payment_transaction(
            network=network,
            pay_to=requirements.pay_to,
            asset=requirements.asset,
            amount=requirements.amount,
            max_timeout_seconds=requirements.max_timeout_seconds,
            extra=dict(requirements.extra) if requirements.extra else None,
        )
        transaction = result.get("transaction") if isinstance(result, dict) else None
        nonce = result.get("nonce") if isinstance(result, dict) else None
        if not isinstance(transaction, str) or not transaction:
            raise RuntimeError("Cardano signer returned an empty transaction")
        if not isinstance(nonce, str) or not _UTXO_RE.match(nonce):
            raise RuntimeError(f"Cardano signer returned an invalid nonce: {nonce}")
        return ExactCardanoPayload(transaction=transaction, nonce=nonce).to_dict()
