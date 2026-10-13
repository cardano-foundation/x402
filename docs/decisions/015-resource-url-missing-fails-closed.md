# 015 — `X402HttpClient` refuses a 402 without `resource.url` when a host policy is set

**Context.** Plan §2 says the host of `PAYMENT-REQUIRED.resource.url` must also be on the allowlist, as defence in depth against redirects. The Spring clients fail closed when the URL is absent (decision 149). The plain-Java `X402HttpClient` skipped the check when `resource` or `url` was missing, so a redirect target could bypass it by leaving the field out.

**Decision.** With a `HostPolicy`, a missing or unparsable `resource.url` returns the 402 unpaid, and nothing is signed. Without a host policy the behaviour is unchanged (TS parity: TS has no allowlist). Test: `X402HttpClientResourceUrlTest`.

**Alternatives.** Fall back to the request host (weaker, and different from the Spring clients).

**Consequences.** A server that omits `resource` cannot be paid through a host-policy client; `resource` is required by the v2 type anyway.

**Reverse.** Restore the `resource != null && url != null` guard in `X402HttpClient`.
