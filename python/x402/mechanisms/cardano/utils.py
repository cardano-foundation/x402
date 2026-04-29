"""Utility helpers for the Cardano `exact` mechanism."""

from __future__ import annotations

import base64
import re
from decimal import Decimal
from typing import Any

from .constants import (
    CARDANO_ASSET_REGEX,
    CARDANO_UTXO_REF_REGEX,
    ERR_CARDANO_SDK_MISSING,
)
from .types import (
    CardanoUtxoOutput,
    DecodedCardanoTransaction,
    ExactCardanoPayload,
)

_ASSET_RE = re.compile(CARDANO_ASSET_REGEX)
_UTXO_RE = re.compile(CARDANO_UTXO_REF_REGEX)


class CardanoSdkMissingError(RuntimeError):
    """Raised when pycardano (the optional SDK) is not installed."""


def parse_asset_unit(asset: str) -> tuple[str, str]:
    """Split a Cardano asset unit.

    Accepts either the literal `"lovelace"` (native ADA — returned as
    `("", "")`) or a `policyId.assetNameHex` pair.

    Args:
        asset: The asset unit string.

    Returns:
        Tuple `(policy_id, asset_name_hex)`, both lowercase. For lovelace
        both elements are empty strings.

    Raises:
        ValueError: If the input is not a valid asset unit.
    """
    if not _ASSET_RE.match(asset):
        raise ValueError(f"Invalid Cardano asset unit: {asset}")
    if asset.lower() == "lovelace":
        return "", ""
    policy_id, asset_name_hex = asset.split(".", 1)
    return policy_id.lower(), asset_name_hex.lower()


def parse_utxo_ref(ref: str) -> tuple[str, int]:
    """Parse a UTXO reference (`txHashHex#index`).

    Args:
        ref: The UTXO reference.

    Returns:
        Tuple `(tx_hash, index)`.

    Raises:
        ValueError: If the input is not a valid reference.
    """
    if not _UTXO_RE.match(ref):
        raise ValueError(f"Invalid Cardano UTXO reference: {ref}")
    tx_hash, index_str = ref.split("#", 1)
    return tx_hash.lower(), int(index_str)


def encode_cardano_payload(payload: ExactCardanoPayload) -> dict[str, Any]:
    """Serialize a payload as a JSON-friendly dict.

    Args:
        payload: The payload to serialize.

    Returns:
        Dict with `transaction` and `nonce` fields.
    """
    return payload.to_dict()


def decode_cardano_payload(raw: dict[str, Any]) -> ExactCardanoPayload:
    """Deserialize a payload from an arbitrary dict.

    Args:
        raw: Raw payload coming from the x402 envelope.

    Returns:
        The typed Cardano payload.

    Raises:
        ValueError: When required fields are missing.
    """
    return ExactCardanoPayload.from_dict(raw)


def output_satisfies(
    output: CardanoUtxoOutput, recipient: str, asset: str, amount: int
) -> bool:
    """Return True when `output` pays at least `amount` of `asset` to
    `recipient`.

    Lovelace (native ADA) is special-cased: the helper compares against
    `output.coin` rather than the multi-asset map.

    Args:
        output: The decoded UTXO output.
        recipient: Required bech32 recipient.
        asset: Asset unit (`policyId.assetNameHex`) or the literal
            `"lovelace"`.
        amount: Required amount in smallest unit.

    Returns:
        True if the output satisfies the requirement.
    """
    if output.address != recipient:
        return False
    if asset.lower() == "lovelace":
        return output.coin >= amount
    available = output.assets.get(asset.lower(), 0)
    return available >= amount


def parse_money_to_decimal(money: str | float | int) -> float:
    """Parse a Money value into a decimal number.

    Handles `$1.50`, `1.50`, `1.5 USDM`, and numeric inputs.

    Args:
        money: Money value as string or number.

    Returns:
        Decimal amount as float.
    """
    if isinstance(money, (int, float)):
        return float(money)
    cleaned = money.strip().lstrip("$")
    cleaned = re.sub(r"\s*(USD|USDC|USDM)\s*$", "", cleaned, flags=re.IGNORECASE).strip()
    return float(cleaned)


def convert_to_token_amount(decimal_amount: str, decimals: int) -> str:
    """Convert a decimal string amount to atomic units.

    Args:
        decimal_amount: Decimal amount (e.g. "0.10").
        decimals: Token decimals.

    Returns:
        Amount in smallest unit, as a string.

    Raises:
        ValueError: If the amount is invalid.
    """
    try:
        amount = Decimal(decimal_amount)
    except Exception as exc:
        raise ValueError(f"Invalid amount: {decimal_amount}") from exc
    return str(int(amount * Decimal(10**decimals)))


def _load_pycardano() -> Any:
    """Lazily import pycardano, surfacing a clear error when it is missing.

    Returns:
        The pycardano module.

    Raises:
        CardanoSdkMissingError: When pycardano is not installed.
    """
    try:
        import pycardano  # type: ignore  # noqa: F401

        return pycardano
    except ImportError as cause:  # pragma: no cover - import guard
        raise CardanoSdkMissingError(
            f"{ERR_CARDANO_SDK_MISSING}: install 'pycardano>=0.10.0' to enable "
            "Cardano transaction verification (pip install x402[cardano])"
        ) from cause


def decode_cardano_transaction(transaction_base64: str) -> DecodedCardanoTransaction:
    """Decode a base64 signed Cardano transaction into a structural summary.

    Uses the optional pycardano SDK; raises CardanoSdkMissingError when
    pycardano is not installed.

    Args:
        transaction_base64: The base64-encoded CBOR transaction.

    Returns:
        The decoded summary used by the facilitator.

    Raises:
        CardanoSdkMissingError: When pycardano is not installed.
        ValueError: When the transaction cannot be decoded.
    """
    pycardano = _load_pycardano()

    try:
        tx_bytes = base64.b64decode(transaction_base64)
    except Exception as exc:
        raise ValueError("Cardano transaction is not valid base64") from exc

    try:
        tx = pycardano.Transaction.from_cbor(tx_bytes)  # type: ignore[attr-defined]
    except Exception as exc:
        raise ValueError("Cardano transaction CBOR could not be decoded") from exc

    body = tx.transaction_body
    tx_hash = body.hash().hex()  # blake2b-256

    network_id = getattr(body, "network_id", None)
    if hasattr(network_id, "value"):
        network_id = int(network_id.value)
    elif network_id is not None:
        try:
            network_id = int(network_id)
        except (TypeError, ValueError):
            network_id = None

    ttl_slot = body.ttl
    if ttl_slot is not None:
        ttl_slot = int(ttl_slot)
    validity_start_slot = getattr(body, "validity_start", None)
    if validity_start_slot is not None:
        validity_start_slot = int(validity_start_slot)

    inputs: list[str] = []
    for inp in body.inputs:
        # pycardano TransactionInput exposes transaction_id (TransactionId) + index.
        h = inp.transaction_id.payload.hex()
        idx = int(inp.index)
        inputs.append(f"{h}#{idx}")

    outputs: list[CardanoUtxoOutput] = []
    for out in body.outputs:
        address = str(out.address)  # bech32
        amount = out.amount
        coin = int(getattr(amount, "coin", amount))
        assets: dict[str, int] = {}
        multi = getattr(amount, "multi_asset", None)
        if multi:
            for policy_id, name_map in multi.data.items():
                policy_hex = policy_id.payload.hex()
                for asset_name, qty in name_map.items():
                    name_hex = asset_name.payload.hex()
                    assets[f"{policy_hex}.{name_hex}".lower()] = int(qty)
        outputs.append(CardanoUtxoOutput(address=address, coin=coin, assets=assets))

    vkey_count, script_count = _count_witnesses(tx)

    return DecodedCardanoTransaction(
        tx_hash=tx_hash,
        network_id=network_id if isinstance(network_id, int) else None,
        ttl_slot=ttl_slot,
        validity_start_slot=validity_start_slot,
        inputs=inputs,
        outputs=outputs,
        vkey_witness_count=vkey_count,
        script_witness_count=script_count,
    )


def _count_witnesses(tx: Any) -> tuple[int, int]:
    """Count vkey/bootstrap and script witnesses on a pycardano transaction.

    Args:
        tx: The pycardano Transaction.

    Returns:
        Tuple `(vkey_witness_count, script_witness_count)`.
    """
    ws = tx.transaction_witness_set
    vkey_count = 0
    script_count = 0
    for attr in ("vkey_witnesses", "bootstrap_witness"):
        seq = getattr(ws, attr, None) or []
        try:
            vkey_count += len(seq)
        except TypeError:
            pass
    for attr in (
        "native_scripts",
        "plutus_v1_script",
        "plutus_v2_script",
        "plutus_v3_script",
        "redeemer",
    ):
        seq = getattr(ws, attr, None) or []
        try:
            script_count += len(seq)
        except TypeError:
            pass
    return vkey_count, script_count
