"""Signer protocols for the Cardano `exact` mechanism."""

from __future__ import annotations

from typing import Any, Protocol

from .types import CardanoSubmissionResult, CardanoUtxoSnapshot


class ClientCardanoSigner(Protocol):
    """Client-side Cardano signer.

    Implementations integrate the user's Cardano wallet / key management. The
    signer receives the desired payment requirements and returns a
    base64-encoded signed Cardano transaction along with the UTXO reference
    used as nonce.
    """

    def get_address(self) -> str:
        """Return the bech32 address that will fund the payment.

        Returns:
            The bech32 payment address.
        """
        ...

    def sign_payment_transaction(
        self,
        *,
        network: str,
        pay_to: str,
        asset: str,
        amount: str,
        max_timeout_seconds: int,
        extra: dict[str, Any] | None,
    ) -> dict[str, str]:
        """Build and sign a Cardano transaction satisfying the supplied
        payment requirements.

        Args:
            network: x402 Cardano network identifier.
            pay_to: Recipient bech32 address.
            asset: Asset unit (`policyId.assetNameHex`).
            amount: Amount in the asset's smallest unit.
            max_timeout_seconds: Transaction lifetime hint.
            extra: Optional extra block (assetTransferMethod metadata).

        Returns:
            Dict with `transaction` (base64 CBOR) and `nonce` (`txHash#index`).
        """
        ...


class FacilitatorCardanoSigner(Protocol):
    """Facilitator-side Cardano signer / chain query protocol.

    The implementation provides chain reads (for nonce/TTL verification) and
    chain writes (for settlement). Verification rule 5 needs `get_utxo`,
    rule 6 needs `get_current_slot`, and settlement needs `submit_transaction`.
    """

    def get_addresses(self) -> list[str]:
        """Return the addresses managed by this facilitator.

        Returns:
            The list of bech32 addresses for `/supported`.
        """
        ...

    def get_utxo(self, ref: str, network: str) -> CardanoUtxoSnapshot:
        """Look up a single UTXO by reference.

        Args:
            ref: UTXO reference (`txHashHex#index`).
            network: The x402 network identifier.

        Returns:
            A snapshot describing the UTXO presence.
        """
        ...

    def get_current_slot(self, network: str) -> int:
        """Return the current absolute slot number for the supplied network.

        Args:
            network: The x402 network identifier.

        Returns:
            The current absolute slot number.
        """
        ...

    def submit_transaction(
        self, signed_transaction_base64: str, network: str
    ) -> CardanoSubmissionResult:
        """Submit a fully signed transaction to the chain.

        Args:
            signed_transaction_base64: The base64-encoded CBOR transaction.
            network: The x402 network identifier.

        Returns:
            The submission result.
        """
        ...


class FacilitatorCardanoSignerWithEvaluate(FacilitatorCardanoSigner, Protocol):
    """Optional capability: a `FacilitatorCardanoSigner` that can also dry-run
    a signed transaction against a Cardano node.

    The base `FacilitatorCardanoSigner` does NOT require `evaluate_transaction`
    so consumers can implement only the four core operations and still pass
    static type checking. `ExactCardanoFacilitatorScheme.verify()` detects
    this method via `getattr` at runtime; signers that implement it gain a
    full cryptographic authorization check inside verify(), beyond the
    structural witness-presence guard.

    The TS counterpart marks the same hook with `evaluateTransaction?(...)`
    on `FacilitatorCardanoSigner`; Python expresses the same "optional method"
    contract through this opt-in subclass-Protocol pattern.
    """

    def evaluate_transaction(self, signed_transaction_base64: str, network: str) -> None:
        """Ask a Cardano node / evaluation service to dry-run the signed
        transaction. Implementations should raise on rejection; the
        exception's str() is surfaced as `invalid_message` on the verify
        response.

        Args:
            signed_transaction_base64: The base64-encoded CBOR transaction.
            network: The x402 network identifier.
        """
        ...
