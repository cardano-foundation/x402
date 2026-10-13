# 099 — `HttpFacilitatorClient` does not follow redirects by default

**Context.** Review finding O5. The default transport used `Redirect.NORMAL` (TS `redirect: "follow"`), so a facilitator answering 3xx would make the JDK resend the request, with its per-endpoint auth headers, to whatever host the `Location` names. This amends decision 035.

**Decision.** The default `HttpClient` uses `Redirect.NEVER`. A 3xx answer to verify, settle or supported throws `FacilitatorResponseException` with that status and the `Location` in the message. The HTTP layer maps it to 502, and it never triggers verify failover (decision 024: only status 0, 429 and ≥ 500 do). A client passed with `Builder.httpClient(...)` keeps its own redirect setting. TS strips trailing slashes from the URL for the same reason (avoiding 308 loops); Java does too. Test: `HttpFacilitatorClientRedirectTest`.

**Alternatives.** Follow same-host redirects only (more code; a facilitator URL that redirects is a configuration error to fix anyway).

**Reverse.** Set `Redirect.NORMAL` in the builder default and drop `rejectRedirect`.
