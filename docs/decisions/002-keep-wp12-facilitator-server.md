# 002 — Keep WP12, the Spring facilitator server

**Context.** No other SDK ships a facilitator HTTP server; their examples hand-write `/verify`, `/settle`, `/supported`. The plan listed it as "beyond parity" (decision 3 in the plan) and left the call open.

**Decision.** Keep it. The user asked what a facilitator developer gets and asked for overridable parts (plan §3a); a YAML-driven server with replaceable beans is the concrete answer. It also powers the e2e Java facilitator and the example.

**Alternatives.** Core `X402Facilitator` only, with a hand-written example (parity, less code, less surface).

**Consequences.** More public API (`FacilitatorHttpHandler`, `x402.facilitator-server.*`). The wire contract is fixed by the TS client schema, so the surface is constrained.

**Reverse.** Drop `org.x402.spring.facilitator` and `FacilitatorHttpHandler`; keep `LocalFacilitatorClient`.
