"""Cardano-specific payload, extra, and decoded transaction types."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, TypedDict


@dataclass
class ExactCardanoPayload:
    """Payload carried inside a Cardano `exact` PaymentPayload.

    `transaction` is a base64-encoded, fully signed Cardano CBOR transaction.
    `nonce` is a UTXO reference (`txHashHex#index`) that MUST also appear as a
    transaction input. The facilitator uses the nonce to enforce uniqueness
    and replay protection (rule 5 in the spec).
    """

    transaction: str
    nonce: str

    def to_dict(self) -> dict[str, Any]:
        """Convert to a JSON-serializable dict.

        Returns:
            Dict with `transaction` and `nonce` keys.
        """
        return {"transaction": self.transaction, "nonce": self.nonce}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ExactCardanoPayload:
        """Create from a payload dictionary.

        Args:
            data: Dict with `transaction` and `nonce` fields.

        Returns:
            The typed payload.

        Raises:
            ValueError: If required fields are missing or empty.
        """
        transaction = data.get("transaction")
        nonce = data.get("nonce")
        if not isinstance(transaction, str) or not transaction:
            raise ValueError("Cardano payload is missing a transaction string")
        if not isinstance(nonce, str) or not nonce:
            raise ValueError("Cardano payload is missing a nonce string")
        return cls(transaction=transaction, nonce=nonce)


class CardanoExtraDefault(TypedDict, total=False):
    """`extra` shape for the default address-to-address Cardano scheme."""

    assetTransferMethod: Literal["default"]


class CardanoExtraMasumi(TypedDict, total=False):
    """`extra` shape for Masumi smart-protocol payments."""

    assetTransferMethod: Literal["masumi"]
    identifierFromPurchaser: str
    sellerVkey: str
    paymentType: str
    blockchainIdentifier: str
    payByTime: str
    submitResultTime: str
    unlockTime: str
    externalDisputeUnlockTime: str
    agentIdentifier: str
    inputHash: str


class CardanoScriptDescriptor(TypedDict):
    """Plutus script descriptor used in the script asset-transfer method."""

    type: Literal["plutusV1", "plutusV2", "plutusV3"]
    code: str  # hex


class CardanoScriptParameter(TypedDict):
    """Single parameter applied to a Plutus script during transaction building."""

    type: Literal["bytes", "bigint", "integer", "string", "constr", "list", "map", "boolean"]
    value: Any


class CardanoExtraScript(TypedDict, total=False):
    """`extra` shape for the script asset-transfer method."""

    assetTransferMethod: Literal["script"]
    scriptHash: str
    script: CardanoScriptDescriptor
    parameters: dict[str, CardanoScriptParameter]


@dataclass
class CardanoUtxoOutput:
    """SDK-agnostic decoded view of a Cardano UTXO output."""

    address: str
    coin: int  # lovelace
    assets: dict[str, int] = field(default_factory=dict)  # `${policy}.${name}` -> qty


@dataclass
class DecodedCardanoTransaction:
    """Decoded view of the parts of a Cardano transaction body needed for
    facilitator verification.
    """

    tx_hash: str
    network_id: int | None
    ttl_slot: int | None
    validity_start_slot: int | None
    inputs: list[str]  # `txHashHex#index`
    outputs: list[CardanoUtxoOutput]
    # Number of vkey + bootstrap witnesses on the transaction. Verifier rejects
    # the payment when both this and `script_witness_count` are zero (unsigned
    # transaction).
    vkey_witness_count: int = 0
    # Number of native + plutus script witnesses (incl. redeemers).
    script_witness_count: int = 0


@dataclass
class CardanoUtxoSnapshot:
    """Lightweight UTXO snapshot returned by chain queries."""

    exists: bool
    address: str | None = None


@dataclass
class CardanoSubmissionResult:
    """Outcome of submitting a transaction to the Cardano network."""

    tx_hash: str
    status: Literal["confirmed", "mempool"]
