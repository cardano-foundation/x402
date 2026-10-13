# WP-13: Cardano works from YAML alone in Spring — server scheme, seller signer, Masumi storage and escrow check, client scheme
Tier: R2
Base: <git rev-parse HEAD at package start>
Check: `X402CardanoAutoConfigurationTest` and `X402CardanoClientAutoConfigurationTest` pass

## Allowed files
- java/x402-spring-boot-autoconfigure/src/main/java/org/x402/spring/cardano/**
- java/x402-spring-boot-autoconfigure/src/main/java/org/x402/spring/client/cardano/**
- java/x402-spring-boot-autoconfigure/src/test/java/org/x402/spring/cardano/**
- java/x402-spring-boot-autoconfigure/src/test/java/org/x402/spring/client/cardano/**
- java/x402-spring-boot-autoconfigure/src/main/resources/META-INF/spring/**
- docs/**

## Rules
- Starts after WP6 (starter on both stacks) and WP8 (all Cardano types exist: WP7 server/facilitator, WP8 client).
- **`X402CardanoAutoConfiguration`** (`@ConditionalOnClass` on the Cardano mechanism; binds `x402.accounts.*.cardano` with its own `@ConfigurationProperties("x402")` record holding only `accounts.<name>.{network, cardano}`):
  - registers `ExactCardanoServerScheme` for every Cardano network named by a used account or inline option
  - implements WP5's `X402OptionContributor` (plan Roles §1a rules 6–7); every decision keys on the option's **merged** `extra`:
    - `cardano.l1-confirmations` (-1..20) → `extra.confirmationPolicy` on that account's options; an option-level `extra.confirmationPolicy` wins
    - Masumi deployment = merged `extra.deployment`, else the network's `cardano.masumi.deployment`, else canonical; none → startup error; merged method `masumi` with neither `pay-to` nor `pay-to-ref` → that deployment's escrow address; Masumi + `pay-to-ref` → startup error; a set `pay-to` must equal it
    - a non-Masumi option whose `pay-to` equals a derived escrow address → startup error; for `pay-to-ref`, a server scheme hook applies this check and the network-tag check per request (500 + log, no 402); the same hook refuses a `price-ref` result whose `extra.assetTransferMethod` differs from the startup-resolved method
    - a Cardano `pay-to` whose address network tag doesn't match the network → startup error
  - Masumi seller settings per network = the union of that network's accounts' `cardano.masumi` blocks (`seller-mnemonic`, `seller-return-address`, `agent-identifier`, `deployment`); the same key with different values → startup error; a Masumi option with no seller setting and no signer → startup error; a `masumi` block on an account without Masumi options → warning
  - override beans are network-aware: `X402CardanoNetworkBeans` resolves `CardanoSellerSigner` / `ClientCardanoSigner` by network; a single plain bean is accepted only when exactly one Cardano network is configured
  - in-memory `MasumiTermsStorage` unless a bean exists (single-instance only; the starter cannot detect multiple instances, so the README states this)
  - a Masumi option whose `pay-to` is not exactly the escrow address of the resolved deployment → startup failure (TS `masumiIssuer.ts:172-185`); tests cover canonical, custom `extra.deployment`, account-level `cardano.masumi.deployment` on Preview (works), and Preview without a deployment (failure)
  - a customizer-registered scheme for the same scheme + network replaces the auto one
- **`X402CardanoClientAutoConfiguration`** (consumes `x402.client.cardano.{mnemonic, networks[]}`):
  - one `ExactCardanoClientScheme` + mnemonic-backed `ClientCardanoSigner` per `networks[]` entry (`network`, `blockfrost.{project-id, base-url}`, optional `mnemonic` override), unless a signer bean exists
  - `blockfrost.base-url` defaults to Blockfrost's URL for the network; an unknown Cardano network without `base-url` → startup error
- Tests:
  - `X402CardanoAutoConfigurationTest`: scheme registered per used network; the contributor sees the account name and adds the policy only to that account's options; an escrow account's address on a `default`-method option → failure; a `pay-to-ref` returning an escrow address on a plain option, or `addr_test…` on a mainnet account → 500, no 402; Masumi `pay-to` derived from the merged method only; `addr_test` on mainnet → failure; Masumi settings union vs conflict; a single seller bean with two networks → failure; seller signer from account property vs bean; conflicting Masumi settings on one network → failure; Masumi `pay-to` derived when omitted; Masumi escrow mismatch → startup failure; customizer override
  - `X402CardanoClientAutoConfigurationTest`: one client scheme per network entry with its own Blockfrost id; per-network mnemonic override; a signer bean wins; lovelace is refused by default spend controls, then accepted via `allowed-assets`

## Proof commands
- red-first: ~/.claude/bin/red-first.sh <Base> --setup 'mvn -q -f java/pom.xml install -DskipTests' java/x402-spring-boot-autoconfigure/src/test/java/org/x402/spring/cardano/X402CardanoAutoConfigurationTest.java java/x402-spring-boot-autoconfigure/src/test/java/org/x402/spring/client/cardano/X402CardanoClientAutoConfigurationTest.java -- mvn -f java/pom.xml -pl x402-spring-boot-autoconfigure test
- green: `mvn -B -f java/pom.xml verify -Pcoverage checkstyle:check spotbugs:check`
- scope: ~/.claude/bin/check-scope.sh docs/work/wp-13-cardano-spring-autoconfig.md

## Log
- 2026-10-12 Base: f8f83309 (no checkpoint commits, decision 001); WP5/WP6 and WP7/WP8 complete in the same tree; mechanism jar from ~/.m2.
- red-first (manual, decision 001): `X402CardanoAutoConfigurationTest` (13 cases) and `X402CardanoClientAutoConfigurationTest` (6) written before any main code → `mvn -B -pl x402-spring-boot-autoconfigure test -Dtest=X402CardanoAutoConfigurationTest,X402CardanoClientAutoConfigurationTest` → BUILD FAILURE, compilation errors (`cannot find symbol org.x402.spring.cardano.X402CardanoNetworkBeans`, `X402CardanoAutoConfiguration`, `X402CardanoClientAutoConfiguration`, `X402CardanoClients`).
- green: `cd java && mvn -B -pl x402-spring-boot-autoconfigure verify -Pcoverage checkstyle:check spotbugs:check` -> exit 0, BUILD SUCCESS; Tests run: 213, Failures 0, Errors 0 (WP13 Check: X402CardanoAutoConfigurationTest 13, X402CardanoClientAutoConfigurationTest 6, both green on the first implementation run); jacoco instructions 0.946, branches 0.836; checkstyle 0 warnings; spotbugs 0. Decisions 140-142.
- Rule text note: the per-request `pay-to-ref` check is in a scheme subclass, not a core scheme hook (core scheme hooks do not cover 402 building; decision 140). `X402CardanoNetworkBeans` also offers `chainBackend` for WP12.
- Scope: org/x402/spring/cardano/**, org/x402/spring/client/cardano/** (main + test), META-INF/spring imports, docs/**.
- IDE metadata for `x402.accounts.*.cardano.*` added to additional-spring-configuration-metadata.json (WP12 step).
- red-first (manual, decision 001), review round 2 (decisions 153-160): `CardanoReviewRound2Test` (9), `FacilitatorReviewRound2Test` (2), `FacilitatorCancelWebFluxTest` (1), `RetryCloseTest` (1) written first. Run with the health test parked: 10 failures + 1 error of 11 (wildcard server/client customizers shadowed by the auto Cardano schemes; base address with the escrow script accepted; price.extra deployment unknown to the earlier escrow check; price.extra confirmationPolicy beat the account's l1-confirmations; non-object deployment gave an NPE; two seller beans silently ignored; CIP-34 alias treated as another network; Masumi template rules only checked per request; WebFlux facilitator settle interrupted when the client left; retry response not closed). `FacilitatorReviewRound2Test` red by compilation (`X402FacilitatorHealthIndicator` missing).
- Scope note (review round 2): `src/main/resources/META-INF/additional-spring-configuration-metadata.json` (outside `META-INF/spring/**`) was edited for IDE metadata. Allowed files amendment: java/x402-spring-boot-autoconfigure/src/main/resources/META-INF/additional-spring-configuration-metadata.json.
- green (review round 2): `cd java && mvn -B -pl x402-spring-boot-autoconfigure verify -Pcoverage checkstyle:check spotbugs:check` -> exit 0, BUILD SUCCESS; Tests run 277, Failures 0, Errors 0; jacoco instructions 0.942, branches 0.840; checkstyle 0; spotbugs 0. Decisions 153-160. Cross-package edits of this round: `X402AutoConfiguration` (defaults SPIs), `OptionDraft`/`OfferResolver` (declared extra, timeout), `X402WebFilter` (`offload` public), `X402ClientHttpRequestFactory` (retry close), new root types `X402SchemeDefaults`, `X402ClientSchemeDefaults`, `ClientSchemes`.
- scope review (`git status --short -uall -- java/x402-spring-boot-autoconfigure java/x402-spring-boot-starter`, 2026-10-12): every change of this agent is under java/x402-spring-boot-autoconfigure (pom, src/main, src/test, resources); the starter module entries are WP1's staged skeleton; docs only under docs/work and docs/decisions.
