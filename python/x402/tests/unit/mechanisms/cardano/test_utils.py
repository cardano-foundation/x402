"""Unit tests for cardano utils."""

import pytest

from x402.mechanisms.cardano import (
    CardanoSdkMissingError,
    CardanoUtxoOutput,
    convert_to_token_amount,
    decode_cardano_payload,
    encode_cardano_payload,
    output_satisfies,
    parse_asset_unit,
    parse_money_to_decimal,
    parse_utxo_ref,
)
from x402.mechanisms.cardano.types import ExactCardanoPayload
from x402.mechanisms.cardano.utils import decode_cardano_transaction

ASSET = "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad.0014df105553444d"
TX_HASH = "a" * 64


def test_parse_asset_unit():
    assert parse_asset_unit(ASSET) == (
        "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad",
        "0014df105553444d",
    )


def test_parse_asset_unit_rejects_invalid():
    with pytest.raises(ValueError, match="Invalid Cardano asset unit"):
        parse_asset_unit("not.a.unit")


def test_parse_utxo_ref():
    assert parse_utxo_ref(f"{TX_HASH}#3") == (TX_HASH, 3)
    with pytest.raises(ValueError):
        parse_utxo_ref(f"{TX_HASH}#-1")


def test_payload_round_trip():
    payload = ExactCardanoPayload(transaction="AAAA", nonce=f"{TX_HASH}#0")
    encoded = encode_cardano_payload(payload)
    decoded = decode_cardano_payload(encoded)
    assert decoded.transaction == "AAAA"
    assert decoded.nonce == f"{TX_HASH}#0"


def test_decode_cardano_payload_rejects_missing_fields():
    with pytest.raises(ValueError):
        decode_cardano_payload({})
    with pytest.raises(ValueError):
        decode_cardano_payload({"transaction": "AA"})


def test_output_satisfies():
    out = CardanoUtxoOutput(address="addr1payee", coin=0, assets={ASSET.lower(): 12_000})
    assert output_satisfies(out, "addr1payee", ASSET, 10_000) is True
    assert output_satisfies(out, "addr1payee", ASSET, 13_000) is False
    assert output_satisfies(out, "addr1other", ASSET, 1) is False


def test_output_satisfies_lovelace_compares_against_coin():
    out = CardanoUtxoOutput(address="addr1payee", coin=5_000_000)
    assert output_satisfies(out, "addr1payee", "lovelace", 5_000_000) is True
    assert output_satisfies(out, "addr1payee", "lovelace", 5_000_001) is False


def test_parse_asset_unit_accepts_lovelace():
    assert parse_asset_unit("lovelace") == ("", "")


def test_parse_money_to_decimal():
    assert parse_money_to_decimal("$1.50") == 1.5
    assert parse_money_to_decimal("1.50 USDM") == 1.5
    assert parse_money_to_decimal(2.5) == 2.5


def test_convert_to_token_amount():
    assert convert_to_token_amount("0.10", 6) == "100000"
    assert convert_to_token_amount("1.00", 6) == "1000000"
    assert convert_to_token_amount("123.456789", 6) == "123456789"
    with pytest.raises(ValueError):
        convert_to_token_amount("abc", 6)


def test_decode_cardano_transaction_without_pycardano(monkeypatch):
    """If pycardano is not importable the helper raises CardanoSdkMissingError.

    Forcing the import to fail simulates a deployment that did not install
    the optional `cardano` extra.
    """
    import sys

    sys.modules.pop("pycardano", None)

    real_import = (
        __builtins__["__import__"] if isinstance(__builtins__, dict) else __builtins__.__import__
    )

    def fake_import(name, *args, **kwargs):
        if name == "pycardano":
            raise ImportError("synthetic missing")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr("builtins.__import__", fake_import)
    with pytest.raises(CardanoSdkMissingError):
        decode_cardano_transaction("AA==")
