"""Unit tests for cardano constants."""

import pytest

from x402.mechanisms.cardano import (
    CARDANO_MAINNET_CAIP2,
    CARDANO_NETWORKS,
    CARDANO_PREPROD_CAIP2,
    CARDANO_PREVIEW_CAIP2,
    SCHEME_EXACT,
    USDM_MAINNET_ASSET,
    USDM_MAINNET_POLICY_ID,
    USDM_PREPROD_ASSET,
    get_cardano_network_id,
    get_default_usdm_asset,
    is_cardano_network,
)


def test_network_identifiers_match_spec():
    """The package uses the spec's verbatim network identifiers."""
    assert CARDANO_MAINNET_CAIP2 == "cardano:mainnet"
    assert CARDANO_PREPROD_CAIP2 == "cardano:preprod"
    assert CARDANO_PREVIEW_CAIP2 == "cardano:preview"
    assert CARDANO_NETWORKS == [
        CARDANO_MAINNET_CAIP2,
        CARDANO_PREPROD_CAIP2,
        CARDANO_PREVIEW_CAIP2,
    ]


def test_scheme_identifier():
    assert SCHEME_EXACT == "exact"


def test_usdm_defaults_match_spec():
    assert len(USDM_MAINNET_POLICY_ID) == 56
    assert (
        USDM_MAINNET_ASSET
        == "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad.0014df105553444d"
    )
    assert get_default_usdm_asset(CARDANO_MAINNET_CAIP2) == USDM_MAINNET_ASSET
    assert get_default_usdm_asset(CARDANO_PREPROD_CAIP2) == USDM_PREPROD_ASSET


def test_get_cardano_network_id():
    assert get_cardano_network_id(CARDANO_MAINNET_CAIP2) == 1
    assert get_cardano_network_id(CARDANO_PREPROD_CAIP2) == 0
    assert get_cardano_network_id(CARDANO_PREVIEW_CAIP2) == 0
    with pytest.raises(ValueError, match="Unsupported Cardano network"):
        get_cardano_network_id("ethereum:1")


def test_is_cardano_network():
    assert is_cardano_network("cardano:mainnet") is True
    assert is_cardano_network("cardano:preprod") is True
    assert is_cardano_network("cardano:preview") is True
    assert is_cardano_network("cardano:sanchonet") is False
    assert is_cardano_network("ethereum:1") is False


def test_get_default_usdm_asset_raises_for_preview():
    with pytest.raises(ValueError, match="No default USDM asset configured"):
        get_default_usdm_asset(CARDANO_PREVIEW_CAIP2)
