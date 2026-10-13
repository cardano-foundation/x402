# 144 — The paid handler's whole response is buffered, headers included

**Context.** Review finding 1 (blocking). Decision 065 let the handler's status and headers reach the real response, and buffered only the body. A paid handler answering `302 Location: <presigned URL>`, or setting a token header or a cookie, leaked it through a failed settle (402) or a facilitator error (502). The client got the content's location without paying.

**Decision.**
- Servlet `BufferingResponse` holds status, headers (case-insensitive), cookies, content type, character encoding, locale, body, `sendError` and `sendRedirect`. Reads see the handler's values first, then whatever outer filters set on the real response. `release()` replays all of it.
- Reactive `BufferingResponse` holds status, a header copy, cookies and `beforeCommit` actions, and applies them in `applyToDelegate()` right before the body is written.
- A failed settle, a 502 and a handler exception therefore write only the x402 response over the outer filters' headers (e.g. CORS).
- `Settlement-Overrides` stays in the wrapper as before.
- This supersedes decision 065's "headers pass through" and "settle failure keeps handler headers". The TS express adapter does keep them; Java deliberately does not, because that behaviour is the leak.

**Tests.** `X402ReviewContract` (MVC + WebFlux): a settled 302 keeps `Location`/token; settle failure → 402 without `Location`, token or cookie; facilitator error → 502 without them.

**Reverse.** Pass headers through again (reopens the leak).
