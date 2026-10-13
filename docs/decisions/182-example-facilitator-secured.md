# 182 — The example facilitator is protected with Spring Security

**Context.** The facilitator server has no authentication of its own (plan §3a; auth is left to Spring Security). WP11 asks the README to cover Spring Security for `/settle` and the CSRF exemption. An example that people copy should not ship an open `/settle`: anyone could relay transactions through the operator's Blockfrost quota.

**Decision.**
- `examples/java/facilitator` depends on `spring-boot-starter-security`. `SecurityConfig`: `GET {base}/supported` public, `{base}/verify` and `{base}/settle` need HTTP Basic, everything else denied, CSRF ignored for `{base}/**`.
- The user is built in `SecurityConfig` (an `InMemoryUserDetailsManager`, password BCrypt-encoded) from `@Value("${FACILITATOR_USER:x402}")` and `@Value("${FACILITATOR_PASSWORD}")`. *Amended by decision 188:* the first version bound `spring.security.user.*` from YAML, which accepted a blank password; the facilitator now refuses to start without a non-blank password.
- The server example sends `Authorization: ${FACILITATOR_AUTHORIZATION:}` through `x402.facilitators[].headers.verify` / `.settle`. The empty default keeps it usable against an unsecured facilitator.
- The x402 part of the facilitator stays YAML-only (`x402.facilitator-server.*`). `PayeeAllowlist` (`onBeforeVerify` and `onBeforeSettle` hooks, decision 189) is active only when `example.allowed-pay-to` is set.

Tests: `FacilitatorExampleTest` (`/supported` without login, 401 without credentials, an authenticated POST passes without a CSRF token, no start without a usable password), `PayeeAllowlistTest` (verify and settle, decision 189).

**Alternatives.** An open facilitator (simpler walkthrough, unsafe to copy); a bearer-token filter of our own (not Spring Security, which the plan names).

**Consequences.** The walkthrough sets `FACILITATOR_PASSWORD` for the facilitator and `FACILITATOR_AUTHORIZATION` for the server. With an empty `FACILITATOR_AUTHORIZATION` the server sends an empty `Authorization` header; Spring Security ignores it, other facilitators normally do too.

**Reverse.** Drop the security dependency and `SecurityConfig`; remove the `headers` blocks from the server YAML.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
