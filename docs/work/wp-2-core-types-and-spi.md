# WP-2: v2 wire types and HTTP codecs byte-match exported TS vectors; core has no Spring dependency
Tier: R2
Base: <git rev-parse HEAD at package start>
Check: `WireVectorsTest` and `ArchitectureTest` in java/x402-core pass

## Allowed files
- java/x402-core/**
- java/tools/ts-vectors/**
- docs/**

## Rules
- **Vector exporter** (`java/tools/ts-vectors/export-core.ts`, run with `pnpm tsx`): imports the built `@x402/core` from `typescript/packages/core` and writes JSON to `java/x402-core/src/test/resources/vectors/`. Each file records the TS commit. Never edit TS sources. Enumerated fixtures:
  1. `PaymentRequired` with 1 and with 3 accepts, with resource + extensions → JSON + `PAYMENT-REQUIRED` base64
  2. `PaymentPayload` with resource + extensions → `PAYMENT-SIGNATURE` base64
  3. `SettleResponse` success / failure / `settlement_pending` (extra.transactionId) → `PAYMENT-RESPONSE` base64
  4. `VerifyResponse` valid / invalid
  5. `SupportedResponse` with kinds + extensions + signers
  6. `parseRoutePattern` + `normalizePath`: one input → match/no-match table per TS unit test case in `x402HTTPResourceServer` tests
  7. `parseMoney` / `convertToTokenAmount` table, including truncation and rejected inputs
- `org.x402.core.types`: immutable records mirroring Go `types/v2.go` + root `types.go`:
  - `PaymentRequirements`, `PaymentRequired`, `PaymentPayload`, `ResourceInfo`
  - `SupportedKind`, `SupportedResponse`, `VerifyResponse`, `SettleResponse`
  - `AssetAmount`, `Price` (sealed: `Money` | `AssetAmount`), `Network` (CAIP-2)
  - Open-ended JSON (`extra`, `extensions`, `payload`) stays a JSON tree.
- SPI in `org.x402.core`, mirroring TS `types/mechanisms.ts` and Go `interfaces.go`:
  - `SchemeNetworkClient` {scheme(), createPaymentPayload(requirements, context)}
  - `SchemeNetworkServer` {scheme(), defaultAssetTransferMethod(), paymentFlows(), parsePrice(price, network), enhancePaymentRequirements(requirements, supportedKind, extensionKeys)}, plus:
    - optional `schemeHooks()` → `SchemeServerHooks` {onBeforeVerify, onAfterVerify, onBeforeSettle, onAfterSettle, …} (TS `types/mechanisms.ts:187-195`, `:258`)
    - optional capabilities `AssetDecimalsProvider`, `SettleOnCancelProvider`, `DynamicExtraFieldsProvider`, `PaymentRequiredEnricher`
  - `SchemeNetworkFacilitator` {scheme(), caipFamily(), getExtra(network), getSigners(network), verify(payload, requirements, `FacilitatorContext`), settle(payload, requirements, `FacilitatorContext`)} (TS `types/mechanisms.ts:109-185`); `FacilitatorContext` {`getExtension(key)`}
  - `FacilitatorExtension` {key} (TS `types/extensions.ts:30`); implementations add their own capability methods
  - `PendingSettlementStore` {get(key), set(key, txHash), delete(key)} (TS `facilitator/pendingSettlementStore.ts`, Go `pending_settlement_store.go:32-38`)
  - hook result types: `VerifyHookResult` {proceed | abort(reason)}, `SettleHookResult` {proceed | abort(reason)}, `FailureHookResult<T>` {none | recovered(result)}
- `HeaderCodec`: base64(JSON) encode/decode, byte-identical to the vectors.
- ArchUnit: x402-core must not depend on `org.springframework..` or `org.x402.mechanisms..`.

## Proof commands
- red-first: ~/.claude/bin/red-first.sh <Base> --setup 'mvn -q -f java/pom.xml install -DskipTests' java/x402-core/src/test/java/org/x402/core/types/WireVectorsTest.java java/x402-core/src/test/java/org/x402/core/ArchitectureTest.java -- mvn -f java/pom.xml -pl x402-core test
- green: `mvn -B -f java/pom.xml -pl x402-core verify -Pcoverage checkstyle:check spotbugs:check`
- scope: ~/.claude/bin/check-scope.sh docs/work/wp-2-core-types-and-spi.md

## Log
- 2026-10-12, red-first (manual, decision 001): `WireVectorsTest`, `MoneyVectorsTest`, `ArchitectureTest` written first; `mvn -pl x402-core test` failed with `package org.x402.core.json does not exist` / `org.x402.http does not exist`.
- Exporter `java/tools/ts-vectors/export-core.ts` (TS core is CommonJS → loaded via `createRequire`; decision 009). Fixtures: payment-required, payment-payload, settle-response, verify-response, supported-response, route-patterns (consumed by WP4), money.
- First green run caught a real bug: `SettleResponse.isPending()` was serialized as `"pending"`; fixed with `@JsonIgnore`.
- SPI shape: optional TS members are **default methods** on the scheme interfaces instead of separate capability interfaces (decision 010). Hook unions are sealed result types in `org.x402.core.hooks.HookResults`. Money from numbers is `BigDecimal`, never `double` (decision 011).
- Green: `mvn -B -pl x402-core verify -Pcoverage checkstyle:check spotbugs:check` → exit 0; 59 tests (vectors 47, SPI 9, architecture 2, smoke 1); coverage instructions 0.91, branches 0.87. Core installed to ~/.m2 for the parallel packages.
