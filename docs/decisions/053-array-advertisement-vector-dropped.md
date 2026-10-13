# 053 — The array-shaped facilitator advertisement vector is not exported

**Context.** TS `assertFacilitatorSupportsRequirements` rejects an advertised `extra` that is not an object ("malformed capability block"). Java's core `SupportedKind.extra` is a `Map`; a JSON array cannot be deserialized into it, so the branch is unreachable in Java. The first export contained this case, and `CardanoServerSchemeTest` (already red-first) could not convert it.

**Decision.** The exporter no longer emits that case (comment in `export-cardano.ts`). The Java test is unchanged.

**Alternatives.** Change core's type (out of scope; core is owned by another package).

**Consequences.** No loss of Java coverage: the guarded state cannot occur.

**Reverse.** Re-add the case if core's `SupportedKind.extra` becomes `Object`.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking; flagged for user sign-off in the final report.
