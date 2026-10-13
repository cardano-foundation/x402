# 062 — Static prices are parsed by the registered scheme at startup

**Context.** `"1.5 ADA"` must fail (plan, WP5 binding test, acceptance "as TS"). The syntax is valid TS `Money`; TS throws only when the scheme parses it, i.e. on the first request.

**Decision.** The money syntax is checked when binding (`PriceSpecConverter`, TS `parseMoney`). `OfferResolver` then calls `parsePrice(price, network)` of the scheme registered for the option (after `X402ResourceServerCustomizer`s ran) and fails startup naming offer, option index and the price. Options whose scheme is not registered are left to core's `missing_scheme` validation. A price object without `amount` or `asset` fails the same way.

**Alternatives.** Fail on the first request (TS behaviour, but a misconfiguration would surface as 500s in production).

**Consequences.** A scheme whose `parsePrice` depends on per-request data must not throw for static prices.

**Reverse.** Remove `staticPrice`'s scheme call.
