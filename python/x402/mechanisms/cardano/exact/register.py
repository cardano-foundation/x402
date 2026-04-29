"""Registration helpers for the Cardano exact payment scheme."""

from __future__ import annotations

from typing import TYPE_CHECKING, TypeVar

from ..constants import CARDANO_NETWORKS

if TYPE_CHECKING:
    from x402 import (
        x402Client,
        x402ClientSync,
        x402Facilitator,
        x402FacilitatorSync,
        x402ResourceServer,
        x402ResourceServerSync,
    )

    from ..signer import ClientCardanoSigner, FacilitatorCardanoSigner

ClientT = TypeVar("ClientT", "x402Client", "x402ClientSync")
ServerT = TypeVar("ServerT", "x402ResourceServer", "x402ResourceServerSync")
FacilitatorT = TypeVar("FacilitatorT", "x402Facilitator", "x402FacilitatorSync")


def register_exact_cardano_client(
    client: ClientT,
    signer: ClientCardanoSigner,
    networks: str | list[str] | None = None,
    policies: list | None = None,
) -> ClientT:
    """Register the Cardano client scheme on an x402 client.

    Args:
        client: The x402Client instance.
        signer: The Cardano client signer.
        networks: Optional specific network(s); defaults to every supported
            Cardano network registered individually (avoids the wildcard
            footgun where unsupported `cardano:*` networks would dispatch
            to this scheme).
        policies: Optional payment policies.

    Returns:
        The client for chaining.
    """
    from .client import ExactCardanoScheme as ClientScheme

    scheme = ClientScheme(signer)
    networks_list = (
        [networks] if isinstance(networks, str) else (networks or list(CARDANO_NETWORKS))
    )
    for network in networks_list:
        client.register(network, scheme)

    if policies:
        for policy in policies:
            client.register_policy(policy)
    return client


def register_exact_cardano_server(
    server: ServerT,
    networks: str | list[str] | None = None,
) -> ServerT:
    """Register the Cardano server scheme on an x402 resource server.

    Args:
        server: The x402ResourceServer instance.
        networks: Optional network(s); defaults to every supported Cardano
            network registered individually.

    Returns:
        The server for chaining.
    """
    from .server import ExactCardanoScheme as ServerScheme

    scheme = ServerScheme()
    networks_list = (
        [networks] if isinstance(networks, str) else (networks or list(CARDANO_NETWORKS))
    )
    for network in networks_list:
        server.register(network, scheme)
    return server


def register_exact_cardano_facilitator(
    facilitator: FacilitatorT,
    signer: FacilitatorCardanoSigner,
    networks: str | list[str] | None = None,
    *,
    accept_mempool: bool = False,
) -> FacilitatorT:
    """Register the Cardano facilitator scheme on an x402 facilitator.

    Args:
        facilitator: The x402Facilitator instance.
        signer: Chain query / submission implementation.
        networks: Optional specific network(s); defaults to every supported
            Cardano network registered individually so unsupported networks
            (e.g. sanchonet) cannot accidentally dispatch via the wildcard
            pattern.
        accept_mempool: When True, settlement succeeds on mempool inclusion
            alone. Defaults to False.

    Returns:
        The facilitator for chaining.
    """
    from .facilitator import ExactCardanoScheme as FacilitatorScheme

    networks_list = (
        [networks] if isinstance(networks, str) else (networks or list(CARDANO_NETWORKS))
    )
    scheme = FacilitatorScheme(signer, accept_mempool=accept_mempool)
    for network in networks_list:
        facilitator.register([network], scheme)
    return facilitator
