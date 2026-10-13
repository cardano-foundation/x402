# 079 — WebClient body recording and replay

**Context.** WP6: record the body while the first request is sent, up to `max-replay-body`; a body that is too large or cannot be recorded gets the 402 back unpaid, with nothing signed.

**Decision.**
- The filter wraps the request's `BodyInserter`. Every buffer passing `writeWith` / `writeAndFlushWith` is copied without moving its read position. Recording restarts if the inserter runs again.
- A request whose inserter never wrote (`setComplete`, e.g. GET) has no body; the paid request reuses the original inserter.
- A body that went over the limit, or whose publisher did not complete, is not replayable: the 402 is returned unpaid and a WARN names `x402.client.max-replay-body`.
- The paid request carries the recorded bytes through a fresh inserter wrapping them with the outgoing message's buffer factory, so the original publisher is never subscribed twice (a single-use `Flux` works; tested).
- Check order matches `X402HttpClient` (decision 034): host → header → `resource.url` host → replayable → not already paid → sign (on `boundedElastic`) → release the first response → send. One `onPaymentResponse` recovery with a fresh payment, as in the blocking client.

**Reverse.** Local to `X402ExchangeFilterFunction`.
