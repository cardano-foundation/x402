# 200 — WP11 review: documentation corrections

**Context.** Independent review of WP11, findings S2 and O1–O4. Each one was checked against the code before editing.

**Decision.**
- **S2: uncapped spend controls.** An `allowed-assets` entry without `max-amount-per-payment` is uncapped (`X402Client.resolveAtomicCap` returns no cap). `allow-any-asset: true` pays non-default assets without any cap. A network pattern such as `cardano:*` also matches mainnet. One sentence each in `java/README.md` (spend controls section and configuration table) and in `application-reference.yml`.
- **O1: redirect section scoped to the Spring clients.** Plain `X402HttpClient` with a `HostPolicy` follows redirects itself, only to allowed hosts. It drops `Authorization`, `Cookie`, `Proxy-Authorization`, `X-Api-Key`, `PAYMENT-SIGNATURE` and `X-PAYMENT` when a redirect changes the origin (decision 012). Without a policy, the wrapped client's own redirect setting applies.
- **O2: escrow budget note.** The 4 × settle budget applies to the core `escrow` payment flow. No Cardano transfer method uses it: `ExactCardanoServerScheme.paymentFlows()` declares `default`, `masumi` and `script` as `authorizationOnly`.
- **O3: TLS.** HTTP Basic sends the password with every request; both READMEs say to put TLS between resource servers and the facilitator.
- **O4: claim store capacity.** The in-memory `SettlementClaimStore` holds at most 4096 claims (`InMemorySettlementClaimStore.DEFAULT_MAX_ENTRIES`). It keeps submitted and settled records until the transaction's TTL plus 120 s. When it is full and nothing is evictable, settle fails with "the Cardano settlement store is at capacity". Production should use a shared store.

**Alternatives.** None; these are corrections.

**Consequences.** Documentation only; the README snippet test still binds every YAML block.

**Reverse.** Revert the edits.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
