# 044 — RFC 8785 JCS implemented in the module

**Context.** Masumi digests are SHA-256 over JCS. The lifted code uses the `erdtman` library, which WP7 may not add (no new compile dependencies). JCS must match JavaScript exactly, including `Number#toString` and the refusal of unpaired surrogates.

**Decision.** `org.x402.mechanisms.cardano.Jcs` canonicalizes maps, lists, strings, numbers, booleans, null, Jackson trees and records. Every number goes through a double (as JavaScript holds it) and is printed with the ECMAScript algorithm (shortest round-tripping digits via `BigDecimal`, then the spec's exponent rules), so JDK 17 and 19+ agree. The same class provides TS `deepEqual` (decision 050).

**Alternatives.** Add the library through the orchestrator (a dependencyManagement change); Jackson with sorted keys (not JCS: number and escape forms differ).

**Consequences.** Covered by the exported JCS vectors (1e21, 1e-7, 5e-324, integers above 2^53, escapes, UTF-16 key order).

**Reverse.** Replace the class body with a library call.
