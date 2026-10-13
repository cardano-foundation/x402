# 052 — Fixture set: the 18 enumerated cases plus variants and settle cases

**Context.** WP7 enumerates 18 verify fixtures. Several rules have two failure modes (TTL expired vs too far; value conservation vs fee floor vs balance-changing body), case 11 is about settlement, and the mutation check needs a failing test per rule.

**Decision.** `cardano-facilitator.json` holds the 18 enumerated fixtures (11 split into out-of-range, depth-without-evidence and the two `-1` settle cases) plus: invalid signature, garbage CBOR, non-canonical requirements, native-asset happy path, value not conserved, input value unavailable, fee below minimum, provider failure, already on the ledger, a second Masumi lock for the same quote, Masumi payTo not the escrow, Masumi settle, a script with four typed parameters, and settle confirmed / pending / submit failed / definitively rejected. Plus the `/supported` capability matrix. The Java test compares the complete TS result object; only a CBOR decoder's own exception text is excluded.

**Alternatives.** Exactly 18.

**Consequences.** 40 fixtures (33 verify, 7 settle), replayed as 40 parameterized cases of `CardanoFacilitatorVectorsTest` (45 tests with its other checks); each of rules 1–9 has at least one failing fixture or test (mutation check in the WP7 log).

**Reverse.** Remove cases from the exporter and regenerate.
