# 026 — `RouteConfigurationError` / `FacilitatorCapabilityError` keep the TS names

**Context.** The plan and WP5 name these errors as TS does. In Java the `Error` suffix usually means `java.lang.Error`.

**Decision.** Keep the plan's names, but both are unchecked exceptions: `org.x402.core.server.FacilitatorCapabilityError extends IllegalStateException` (with `problems()`), and WP4's `org.x402.http.RouteConfigurationError extends IllegalArgumentException` (with `errors()`). Other build failures: missing scheme or kind → `IllegalStateException` with TS's message; unknown facilitator pin → `IllegalArgumentException` (WP3: "unknown identifier → IllegalArgumentException").

**Alternatives.** `…Exception` names (idiomatic, but WP5/WP11 text and TS cross-references would diverge).

**Consequences.** Catching `IllegalStateException` also catches capability errors; `isFatalStartupError` distinguishes them.

**Reverse.** Rename with deprecated subclasses carrying the old names.
