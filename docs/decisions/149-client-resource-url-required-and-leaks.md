# 149 — A 402 without `resource.url` is not paid; paid responses are always released

**Context.** Review findings 6 and 8.

**Decision.**
- Blocking and reactive clients return the 402 unpaid when `PAYMENT-REQUIRED.resource` or its `url` is absent or unparsable. Plan §2: the resource host "must also be on the list". `X402HttpClient` (core) still skips the check when the URL is absent; that is a core follow-up, reported.
- Blocking: if an `onPaymentResponse` hook throws, the paid response is closed before the exception propagates.
- Reactive: the paid or retried response is released when the hook errors, and the unpaid 402 is released when the subscription is cancelled during signing.

**Tests.** `ReviewFindingsTest#a402WithoutResourceUrlIsNotPaid` (both stacks), `#aThrowingPaymentResponseHookStillClosesThePaidResponse`.

**Reverse.** Local to the two client classes.
