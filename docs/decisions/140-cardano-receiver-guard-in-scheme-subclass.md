# 140 — The per-request Cardano receiver check lives in a scheme subclass

**Context.** WP13: for `pay-to-ref` receivers, "a server scheme hook applies [the escrow and network-tag checks] per request (500 + log, no 402)". Core's scheme hooks (`SchemeServerHooks`) cover verify and settle, not 402 building. Requirements are built per request by `X402ResourceServer.buildPaymentRequirements`, which calls the scheme's `enhancePaymentRequirements` and lets its exceptions propagate to the adapter (500, logged).

**Decision.**
- The starter registers `GuardedCardanoServerScheme`, a subclass of `ExactCardanoServerScheme`. Its `enhancePaymentRequirements` checks every plain (non-Masumi) receiver: it must parse, carry the network's address network id, and not be a known escrow address. A failure throws an `IllegalStateException`, so no 402 is issued.
- Static receivers are checked at startup by `CardanoOptionContributor` with the same rules (`CardanoAddressRules`).
- The `price-ref` transfer-method rule is already enforced generically (decision 071).
- One scheme instance is registered per used Cardano network, under the network string as written, with the highest customizer precedence, so an application customizer that registers the same scheme and network replaces it (core: later registration wins).

**Alternatives.** Wrap the `X402DynamicPayTo` bean (the contributor sees only the bean name, so the wrapping would happen outside the SPI); an after-verify hook (too late: the 402 would already have advertised the address).

**Reverse.** Register the plain `ExactCardanoServerScheme`; the per-request check is then gone.

**Superseded in part by [153](153-default-schemes-after-customizers.md):** the schemes are now registered after every customizer and only where no scheme answers (wildcards included), not first with the highest precedence.
