# 184 — How `ExampleProfilesSmokeTest` keeps YAML and READMEs honest

**Context.** Decision 005: `application-reference.yml` lists every `x402.*` key and is bound through the real `X402Properties` so it cannot drift. WP11: the same test parses every YAML snippet of the Java READMEs. But `X402Properties` ignores unknown fields on purpose (decision 061: the Cardano auto-configuration binds `x402.accounts.*.cardano` over the same prefix), so a plain bind proves nothing about typos or moved keys.

**Decision.**
- **Strict binding over owned slices.** Each properties class is bound with Spring's `NoUnboundElementsBindHandler` (what `ignoreUnknownFields = false` uses) over a filtered property source holding only the names it owns:
  - `X402Properties`: `x402.*` minus `x402.accounts.*.cardano.*` and `x402.facilitator-server.*`;
  - `X402CardanoProperties`: `x402.accounts.*.network` and `x402.accounts.*.cardano.*`;
  - `X402FacilitatorServerProperties`: `x402.facilitator-server.*`.

  Any key no class binds fails. The money converter (`PriceSpecConverter`) is registered, so prices are checked too.
- **Completeness.** Every leaf name of the starter's configuration metadata must match a key of `application-reference.yml` (`*` = any map key, `[]` = any index; map-valued names also match their entries), and every reference key must match a metadata name. Both `META-INF/spring-configuration-metadata.json` and `additional-spring-configuration-metadata.json` are read: an autoconfigure jar installed from an incremental build (19:39) had a merged file without the `accounts.*.cardano.*` and `facilitator-server.cardano.networks[]` entries, although its additional file had them. The jar reinstalled at 20:08 is complete; reading both keeps the check independent of how the jar was built.
- **README snippets.** Every ` ```yaml ` block in `java/README.md` and `examples/java/**/README.md` is parsed with SnakeYAML; blocks with an `x402` root are also bound strictly. Placeholders resolve to their default, else to a test address (`PREPROD_PAY_TO`, `MAINNET_PAY_TO`), else to their name. The test asserts at least 20 blocks and 15 bound ones, so it cannot pass vacuously.
- **Java snippets** in the READMEs are copied from compiled example classes. For that, the examples gained `X402Customizations` (server hook, dynamic price), `PayeeAllowlist` (facilitator hook) and `SelfBuiltRestClientConfig` (two-argument `decorate`).
- **Profiles.** The default, `multi-facilitator` and `mainnet` profiles start against WireMock facilitators: 402 unpaid, 200 paid with `PAYMENT-RESPONSE`, the facilitator receives the configured `Authorization` header, verify fails over to the backup and settle follows it, and the `x402` health details list both facilitators.

Mutation checks run once by hand (2026-10-12): an unknown key (`schem`), a removed key (`cooldown-period`), an unknown key in a README block (`pay-too`) and an unquoted `${…}` in a flow map each failed the test; the files were restored byte-identical. Spring's relaxed binding accepts `payto` for `pay-to`, so that is not an unknown key.

**Alternatives.** Bind `X402Properties` only (ignores unknown keys, proves little); compare against the metadata only (misses keys documented but not bound).

**Consequences.** Adding a property to the starter without adding it to `application-reference.yml` fails the example build. A README YAML block that binds to nothing fails too.

**Reverse.** Replace the strict handler with `BindHandler.DEFAULT` and drop the completeness checks.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
