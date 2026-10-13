# 189 — The payee allowlist also guards `/settle`

**Context.** Independent review of WP11, finding S1: the example's `PayeeAllowlist` registered only `onBeforeVerify`. The facilitator's `/settle` endpoint can be called without a prior `/verify`, so a payment to any address could still be settled through it. The README taught the verify-only form as the policy pattern.

**Decision.**
- `PayeeAllowlist` registers the same predicate on `onBeforeVerify` and `onBeforeSettle`. Both abort with `payee_not_allowed`: verify answers `isValid: false`, settle answers the wire abort body (`success: false`, empty `transaction`).
- `java/README.md` and the facilitator README say a policy hook belongs on both hooks.
- Both READMEs and the class Javadoc state the Masumi limit: for Masumi options `payTo` is the escrow address, and the canonical deployment's escrow address is shared by every Masumi seller, so allowing it admits all Masumi sellers. Telling sellers apart needs a custom hook that reads the seller from the escrow datum.

Test: `PayeeAllowlistTest#settlingAPaymentToAnotherAddressIsAborted`. Red first: without the settle hook the answer was `errorReason: invalid_exact_cardano_payload` (the request reached the Cardano scheme).

**Alternatives.** Document only (the example would keep teaching an incomplete policy).

**Consequences.** None beyond the example.

**Reverse.** Remove the `onBeforeSettle` registration.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
