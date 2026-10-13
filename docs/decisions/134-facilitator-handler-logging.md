# 134 — The facilitator handler logs one line per verify and settle

**Context.** Plan §3a promises that the facilitator server writes "one log line per verify and settle with network, payTo, result". The Spring server (the later WP12 step) only forwards bytes to `FacilitatorHttpHandler`, so it cannot see these values without parsing the body again.

**Decision.** `FacilitatorHttpHandler` logs through `System.Logger` (decision 023):
- INFO `[x402] facilitator verify network=… payTo=… isValid=… [invalidReason=…]`
- INFO `[x402] facilitator settle network=… payTo=… success=… transaction=… [errorReason=…]`
- WARNING with the exception for every 500

Request values are JSON-quoted, so a crafted value cannot forge log lines. `LocalFacilitatorClient` does not log, because the resource server already logs its side.

**Consequences.** Apps that call the handler from their own controllers (`expose-http=false`) get the same lines. No payload or signature data is logged.

**Reverse.** Remove the two `LOG.log` calls.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
