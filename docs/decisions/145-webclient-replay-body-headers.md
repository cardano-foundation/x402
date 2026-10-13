# 145 — The WebClient paid retry restores the body writer's headers

**Context.** Review finding 2. Decision 079 replayed the recorded bytes but not the headers the body writer set while encoding (`Content-Type`, including a multipart boundary; `Content-Encoding`). A `bodyValue(pojo)` without an explicit content type, or a multipart body, therefore arrived as an untyped or unparsable body on the paid request.

**Decision.** The recording decorator snapshots `Content-Type`, `Content-Encoding` and `Content-Language` from the outgoing message when the writer starts. The replay inserter sets each one the paid request lacks. Headers the caller set explicitly are copied by `ClientRequest.from` and win.

**Tests.** `ReviewFindingsTest#webClientReplayKeepsTheHeadersTheBodyWriterSet` covers JSON `bodyValue` and multipart. The replay uses the same boundary, so the body parses.

**Reverse.** Drop the snapshot.
