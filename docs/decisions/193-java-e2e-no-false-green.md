# 193 — Java e2e components never report a degraded run as a pass

**Context.** The WP10 review found two false-green paths.
1. **Servers.** `E2eServerLifecycle` printed `Server listening` even when the starter's startup sync left x402 `AWAITING_FACILITATORS` (paid routes answer 503) or `INVALID` (500).
2. **Client.** `java-http` reported `success: true` for any status other than 402.

The harness passes a scenario whose client exits 0 with a non-402 status and no `PAYMENT-RESPONSE` (`e2e/test.ts` `runClientTest`; `GenericClientProxy` ignores the JSON `success` field on exit 0). A degraded server plus this client therefore produced a passing scenario with no payment at all.

**Decision.**
- **Servers.** The `ApplicationReadyEvent` listener reads the `X402ServerLifecycle` bean, when there is one. If `status() != READY`, it prints the status and the facilitator identifiers to stderr and calls `System.exit(1)` **before** the ready line. The harness then sees a startup failure.
- **Client.**
  - `success` is `true` only for a 2xx answer, and then only if the `PAYMENT-RESPONSE`, when present, reports success.
  - Exit code:
    - 2xx and 402: exit 0. The harness itself fails a 402 or a failed settlement.
    - Any other status: the line also carries `error: "unexpected HTTP status N from <path>"`, and the client exits 1, so the harness reports it. This extends decision 170 (exit 1 whenever the run must not count as passed).
    - The request could not complete: unchanged (exit 1).

**Evidence.**
- spring-mvc and spring-webflux with `FACILITATOR_URL` pointing at a closed port: exit 1, no `Server listening`, stderr `x402 is AWAITING_FACILITATORS (facilitators [http://localhost:4199]); paid routes cannot be served, exiting`.
- java-http against a fixture answering 503: `{"success":false,"data":{…},"status_code":503,"error":"unexpected HTTP status 503 from /exact/cardano/default"}`, exit 1.
- Live default (java-http × spring-mvc × TS facilitator, preprod): 200, settled, tx `2ad160fa…5aa75`, exit 0.

**Alternatives.**
- Keep exit 0 for 5xx: the harness would still pass it.
- Wait in the server for `READY`: the harness's 30 s start timeout would mark it ready anyway.

**Reverse.** Drop the status check in `E2eServerLifecycle` and the exit rule in `Main`.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
