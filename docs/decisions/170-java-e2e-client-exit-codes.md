# 170 — Java e2e client: exit 1 with a JSON error when the request cannot complete

**Context.** WP10 says the Java client "prints one JSON line `{success,data,status_code,payment_response[,error]}`; exits 0". The harness (`e2e/src/proxy-base.ts` `runOneShotProcess`, `e2e/test.ts` `runClientTest`) treats exit 0 plus a JSON line as a completed call. It then fails the call only on `status_code === 402` or a failed `payment_response`. A line `{"success":false,"error":"..."}` with exit 0 and no status code therefore **passes**. The Go client has this latent false green: `ToAggregate` drops `Error` and `Emit` exits 0. Reported, not changed (not in WP10 scope).

**Decision.**
- The client exits 0 whenever the server answered, whatever the status. `success` is the settle result when there is one, else `status != 402`.
- When the request cannot complete (missing env, signing refused, network error, timeout), it prints exactly one line `{"success":false,"error":"<Class>: <message>"}` and exits 1, so the harness reports the error.
- `System.out` is redirected to stderr during the run, so only the result line reaches stdout. The harness takes the first stdout line that starts with `{`.

**Alternatives.**
- Always exit 0 (the literal WP text): failures would count as passes.
- Throw and let the JVM print a stack trace (TS behaviour): failures would surface, but the harness gets no message.

**Consequences.** Successful calls have the same observable contract as the TS client. Failures surface with a readable reason.

**Reverse.** In `e2e/clients/java/http/java-http/src/main/java/org/x402/e2e/client/Main.java` `main`, set `exitCode = 0` in the catch block.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
