# 068 — Payment client configuration details

**Context.** WP5 maps `x402.client.*` to core; a few points were open.

**Decision.**
- `prefer.schemes` is registered before `prefer.networks`; both are stable partitions, so the network preference dominates and the first entry of each list wins (plan §2).
- `spend-controls.max-amount-per-payment` empty = no USD cap (TS `maxAmountPerPayment: false`); default `"$1"`.
- The blocking factory mirrors `X402HttpClient` (decision 034): non-x402 402 returned unchanged; malformed header, refused selection and an already-paid request throw `X402ClientException`; one `onPaymentResponse` recovery with a fresh payment.
- The `X402Client` bean and `HostPolicy` bean (`x402ClientHostPolicy`) live in `X402AutoConfiguration` so the blocking and reactive client configurations share them; an empty `hosts` list logs one startup warning.

**Reverse.** Local to `X402AutoConfiguration.ClientConfiguration` / `X402ClientHttpRequestFactory`.
