# 101 — The client's Masumi collateral ceiling is checked before the wallet's UTxOs are read

**Context.** TS `signer.ts` queries the wallet UTxOs and then builds the lock and checks collateral against `masumiMaxCollateralLovelace`. WP8's rule puts every Masumi guard, the collateral ceiling included, before any UTxO query or selection.

**Decision.** After the guards that need no chain data:
1. read the protocol parameters (one call, no UTxO query);
2. build the lock with the wallet's own address as buyer;
3. run the datum invariants against `payTo`;
4. refuse collateral above the ceiling (default 15 ADA).

Only then are the UTxOs read. The outcome matches TS: the same refusal and the same datum, because the buyer is the wallet address either way. `MasumiClientGuardsTest` asserts zero UTxO queries for an over-ceiling quote. Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking; flagged for user sign-off in the final report.

**Alternatives.** The TS order (it violates the WP rule and touches the wallet for a quote that will be refused).

**Consequences.** A refused quote costs one protocol-parameter read instead of a UTxO read.

**Reverse.** Move the ceiling check after `getAddressUtxos`.
