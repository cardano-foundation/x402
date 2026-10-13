# 003 — Examples write prices as `"$0.50"`

**Context.** TS `parseMoney` accepts `"$0.50"`, `"0.50"`, `"0.50 USD"` and `"0.50 USDM"`. Every TS/Go/Python example uses `$`. The user didn't pick a notation.

**Decision.** README and examples use `"$0.50"`, with a comment that `$` means the network's default stablecoin (USDM on Cardano) at 1:1, no exchange rate. The ticker form stays accepted and is shown once.

**Alternatives.** Ticker form everywhere (more explicit, unfamiliar to x402 users); atomic `{amount, asset}` only (least readable).

**Reverse.** Documentation change only.
