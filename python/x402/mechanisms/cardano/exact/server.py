"""Cardano server implementation for the Exact payment scheme (V2)."""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

from ....schemas import (
    AssetAmount,
    Network,
    PaymentRequirements,
    Price,
    SupportedKind,
)
from ..constants import (
    CARDANO_ASSET_REGEX,
    SCHEME_EXACT,
    USDM_DEFAULT_DECIMALS,
    get_default_usdm_asset,
    is_cardano_network,
)
from ..utils import convert_to_token_amount, parse_money_to_decimal

MoneyParser = Callable[[float, str], AssetAmount | None]

_ASSET_RE = re.compile(CARDANO_ASSET_REGEX)


class ExactCardanoScheme:
    """Cardano server-side implementation for the Exact scheme (V2).

    Parses prices and enhances payment requirements. Most Cardano-specific
    extras (Masumi, script) are produced by the operator at request time, so
    the server passes the supportedKind extras through unmodified.

    Attributes:
        scheme: Scheme identifier ("exact").
    """

    scheme = SCHEME_EXACT

    def __init__(self) -> None:
        """Create the server scheme."""
        self._money_parsers: list[MoneyParser] = []

    def register_money_parser(self, parser: MoneyParser) -> ExactCardanoScheme:
        """Register a custom Money parser.

        Parsers are tried in registration order; the first non-None result
        wins. Returning None defers to the next parser.

        Args:
            parser: The parser to register.

        Returns:
            Self for chaining.
        """
        self._money_parsers.append(parser)
        return self

    def parse_price(self, price: Price, network: Network) -> AssetAmount:
        """Convert a Price into an AssetAmount.

        Args:
            price: The price to parse (Money or AssetAmount).
            network: The Cardano network identifier.

        Returns:
            The resolved AssetAmount.

        Raises:
            ValueError: If the input is invalid for Cardano.
        """
        if isinstance(price, dict) and "amount" in price:
            asset = price.get("asset")
            if not asset:
                raise ValueError(
                    f"Asset unit must be specified for AssetAmount on network {network}"
                )
            if not _ASSET_RE.match(asset):
                raise ValueError(f"Invalid Cardano asset unit: {asset}")
            return AssetAmount(amount=price["amount"], asset=asset, extra=price.get("extra") or {})
        if isinstance(price, AssetAmount):
            if not price.asset or not _ASSET_RE.match(price.asset):
                raise ValueError(f"Invalid Cardano asset unit: {price.asset}")
            return price

        decimal = parse_money_to_decimal(price)
        for parser in self._money_parsers:
            result = parser(decimal, str(network))
            if result is not None:
                if not _ASSET_RE.match(result.asset):
                    raise ValueError(
                        f"Custom money parser returned invalid Cardano asset: {result.asset}"
                    )
                return result
        return self._default_money_conversion(decimal, str(network))

    def enhance_payment_requirements(
        self,
        requirements: PaymentRequirements,
        supported_kind: SupportedKind,
        extension_keys: list[str],
    ) -> PaymentRequirements:
        """Pass facilitator extra metadata through to the client.

        Args:
            requirements: Base payment requirements.
            supported_kind: SupportedKind from the facilitator.
            extension_keys: Extension keys (unused for Cardano default).

        Returns:
            Enhanced payment requirements.
        """
        _ = extension_keys
        if not is_cardano_network(str(supported_kind.network)):
            raise ValueError(f"Unsupported Cardano network: {supported_kind.network}")
        # Merge supported_kind extras with whatever the requirements already
        # carry; requirements take precedence so server-side overrides are
        # respected.
        if requirements.extra is None:
            requirements.extra = {}
        merged: dict[str, Any] = {}
        for key, value in (supported_kind.extra or {}).items():
            merged[key] = value
        for key, value in (requirements.extra or {}).items():
            merged[key] = value
        requirements.extra = merged
        return requirements

    def get_asset_decimals(self, asset: str, network: Network) -> int:
        """Return the decimal precision for the supplied asset.

        Default implementation returns USDM/USDC decimals (6); integrators
        with custom tokens should subclass.

        Args:
            asset: Asset unit string.
            network: Network identifier.

        Returns:
            Decimal precision for the asset (default 6).
        """
        _ = asset, network
        return USDM_DEFAULT_DECIMALS

    def _default_money_conversion(self, decimal_amount: float, network: str) -> AssetAmount:
        """Convert a Money decimal to USDM atomic units.

        Honors `get_asset_decimals()` so subclasses that override the hook
        for non-USDM tokens get correctly scaled atomic amounts.

        Args:
            decimal_amount: Decimal amount (e.g. 1.50).
            network: The Cardano network identifier.

        Returns:
            AssetAmount in default-asset smallest units.
        """
        asset = get_default_usdm_asset(network)
        decimals = self.get_asset_decimals(asset, network)
        atomic = convert_to_token_amount(str(decimal_amount), decimals)
        return AssetAmount(amount=atomic, asset=asset, extra={})
