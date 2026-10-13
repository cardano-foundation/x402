# 030 — Client surface: one exception type, no client extensions yet

**Context.** TS `x402Client` throws plain `Error`s, supports `ClientExtension` (`enrichPaymentPayload`, extension hooks) and v1 registration. The Java plan has no client extensions and is v2-only.

**Decision.**
- All client refusals (no registered scheme, no recognized flow, spend controls, policies, hook abort) throw `org.x402.core.client.X402ClientException` with TS's message.
- `SpendControls` is a record: `enabled` (TS `false` = `disabled()`), `maxAmountPerPayment` (money string, `null` = TS `false`), `allowAnyAsset` (TS `allowedAssets: true`), `allowedAssets`.
- `selectPaymentRequirements` is public (TS private) so transports and tests can preview the choice.
- No `ClientExtension` / `registerV1`. Scheme-provided extensions are still merged with TS `mergeExtensions` rules (builder-code `s` additive).
- `PaymentPolicies.preferNetwork/preferScheme` take varargs; the first value is most preferred (stable partitions applied in reverse order).

**Reverse.** Add `ClientExtension` additively when a Java client extension exists.
