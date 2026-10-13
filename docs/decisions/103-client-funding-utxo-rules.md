# 103 — Client funding: reference-script UTxOs are never spent; lovelace below min-UTxO is refused, not raised

**Context.** Spending an input that carries a reference script adds that script's size to the Conway minimum fee. The client's fee formula (`minFeeA * size + minFeeB`, as in the Go port) does not include that term, so such a transaction could fail phase-1. Separately, a lovelace payment below the output's min-UTxO cannot be raised without paying more than the requirement's amount. A native-asset or script payment, by contrast, carries its coin as a deposit on top of the priced asset.

**Decision.**
- **Nonce and selection.** UTxOs with a reference script are filtered out before selection. The nonce is the first remaining UTxO in provider order, and it is always spent. Further inputs are chosen by a fixed preference: pure-ADA UTxOs first, by coin descending. Token UTxOs are chosen only when an asset is short.
- **Datums.** Datum-bearing UTxOs at the wallet's key address are spendable and not excluded. A datum has no fee impact, so the Step 0 note "or a datum" is narrowed accordingly.
- **Coin amounts.** A plain lovelace payment below min-UTxO fails with "payment of X lovelace is below the min-UTxO of Y". The facilitator would reject it as `min_utxo_insufficient` anyway. Native-asset and script outputs raise their coin to min-UTxO. Masumi lock coin is exact (`requested + collateral`) and never raised.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking; flagged for user sign-off in the final report.

**Alternatives.**
- Include reference-script sizes in the fee (needs the script bytes from the provider).
- Raise lovelace payments (overpays the seller).

**Consequences.** A wallet holding only reference-script UTxOs reports "Funding wallet has no UTXOs available for the payment".

**Reverse.** Drop the filter and add the reference-script fee term.
