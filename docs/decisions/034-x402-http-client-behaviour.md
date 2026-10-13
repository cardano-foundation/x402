# 034 — `X402HttpClient` behaviour details

**Context.** WP4 fixes the outline (wrap, host policy, own redirects, bounded body replay, 240 s default timeout). Several details were left open.

**Decision.**
- **Non-x402 402** (no `PAYMENT-REQUIRED` header) is returned unchanged. TS `wrapFetch` throws here; a general-purpose Java client should not fail on unrelated 402 APIs. A malformed header, a refused selection ("Failed to create payment payload: …") and a request that already carries `PAYMENT-SIGNATURE` ("Payment already attempted") throw `X402ClientException`, as TS throws. The already-attempted check runs before signing (TS signs first).
- **Order of the pre-signing checks:** host of the URI that answered 402 → header present / parsable → `resource.url` host → body replayable → not already paid. Only then is a payload created.
- **Redirects with a `HostPolicy`:** followed like `Redirect.NORMAL` (no https→http downgrade, 303 and POST 301/302 become GET, 307/308 keep method and replay the recorded body), at most 5 hops. Unsigned requests follow any host (nothing is signed; a 402 from an off-list host is then returned unpaid). Signed requests are never sent to an off-list host: the redirect response is returned. The paid retry goes to the original URI, as TS retries the cloned original request.
- **Bodies:** recorded while the first request is sent; the recorder restarts if the JDK re-subscribes. Over `maxReplayBody`, incomplete, or failed → the 402 is returned unpaid and a WARNING is logged.
- **Recovery:** if an `onPaymentResponse` hook returns true, one fresh payment is made and sent; its hooks run without further recovery (TS).
- **`sendAsync`** runs the blocking flow on the delegate's executor, else the common pool; push promises are ignored.
- **Previous responses** in a redirect chain the wrapper followed carry a `null` body.

**Reverse.** Each point is local to `X402HttpClient`.
