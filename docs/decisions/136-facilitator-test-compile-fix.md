# 136 — A test compile defect corrected after red-first (WP12 core)

**Context.** Tests are immutable once their red-first run is logged. The red run of `LocalFacilitatorClientTest` stopped at the missing production classes, so the compiler never reached three lines of the form `assertThat(same(c -> c.verify(...)))`. Once the classes existed, `javac` reported those lines as ambiguous: while inferring `same`'s generic type it could pick either AssertJ `assertThat(IntPredicate)` or `assertThat(Predicate<T>)`.

**Decision.** Add explicit type witnesses (`this.<VerifyResponse>same(...)`, `this.<SettleResponse>same(...)`) and wrap the one line that became too long. No assertion, input or expected value changed.

**Alternatives.** Leave the test uncompilable, which blocks the gate.

**Consequences.** The fix is recorded in the WP12 log next to the red-first entry. Precedent: decision 054.

**Reverse.** n/a.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking. Flagged for user sign-off in the final report.
