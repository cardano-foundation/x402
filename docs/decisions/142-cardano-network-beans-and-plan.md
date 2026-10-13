# 142 — Network-aware beans, Masumi settings union, and the escrow set

**Context.** WP13 and plan §1a rule 7 leave several mechanics open.

**Decision.**
- **Network beans:** `X402CardanoNetworkBeans` has default methods `sellerSigner`, `clientSigner` and `chainBackend` (the last one for WP12), each returning `null` for "use YAML". Resolution order: the provider, then a single plain bean, then YAML.
  - A plain bean with more than one configured Cardano network fails startup and names the provider, even when no option needs that bean.
  - The count is per role: used server networks for the seller, `client.cardano.networks[]` entries for the buyer.
- **Masumi settings** of a network are the union over **all** accounts on that network that have a `cardano.masumi` block, used or not. A key set twice with different values fails startup, naming both accounts.
  - An account with a `masumi` block that no Masumi option uses gets a warning; its settings still apply to the network.
  - Each network's scheme gets a Masumi issuer only when a seller is available. A Masumi option without one fails startup.
- **Escrow set:** before any offer is resolved, `CardanoServerPlan` collects each used network's escrow addresses: the canonical deployment, the network-level `cardano.masumi.deployment`, and every `extra.deployment` declared on accounts or options. Plain receivers are checked against this set at startup and per request, regardless of option order.
- **Client** (`X402CardanoClients` bean, inspectable):
  - `blockfrost.project-id` is required unless `blockfrost.base-url` is set (self-hosted endpoint).
  - The mnemonic comes from the entry, else `client.cardano.mnemonic`, else a signer bean; with none of them, startup fails.
  - The Cardano client customizer has the highest precedence, so application customizers replace its schemes.

**Reverse.** Local to `org.x402.spring.cardano` / `org.x402.spring.client.cardano`.

**Superseded in part by [155](155-escrow-by-script-hash.md) and [157](157-cardano-config-hardening.md):** escrow detection also uses script hashes and `price.extra` deployments; networks are keyed by canonical id; several plain beans without `@Primary` fail.
