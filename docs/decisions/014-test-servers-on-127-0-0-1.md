# 014 — Spring tests address their own server as `127.0.0.1`

**Context.** My verification run of the autoconfigure gate failed once. In `X402PaymentWebFluxTest>springSecurityAnswers401BeforeX402Answers402`, the test's HTTP client received an H2 database banner (`Version mismatch … H2`) instead of an HTTP answer. `localhost` resolved to IPv6 `::1`, where an unrelated local process listened on the same port number as the test server's IPv4 socket. Three isolated reruns were green.

**Decision.** The test helpers that build URLs for the application under test use `127.0.0.1`, not `localhost`. The server listens there in both binding modes (IPv4 and dual-stack). Client host-policy tests that deliberately use `localhost` against WireMock are unchanged. Only URL builders changed; no assertion changed.

**Alternatives.** Pin `server.address` in every test context; mark the test flaky (it would also flake on CI runners).

**Consequences.** The tests are deterministic on machines with IPv6 listeners. Resource URLs observed in these tests now carry `127.0.0.1`; no assertion depended on the host.

**Reverse.** Replace `127.0.0.1` with `localhost` in the seven helper methods.
