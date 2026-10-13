# 159 — The recovered retry's response is closed when the hook throws

**Context.** Review round 2, finding 11 (blocking client).

**Decision.** `X402ClientHttpRequestFactory` closes the retry response when the second `onPaymentResponse` call throws, as it already does for the first paid response (decision 149).

**Test.** `RetryCloseTest`. Red first.

**Reverse.** Local.
