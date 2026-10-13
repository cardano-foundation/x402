# 050 — Requirements equality is canonical-JSON equality

**Context.** The terms binding and the stored-quote match compare requirements with TS core `deepEqual`, which compares normalized `JSON.stringify` output (key order ignored). Java values parsed from JSON may hold `Integer`, `Long` or `BigInteger` for the same number, so `Map.equals` would disagree with TS.

**Decision.** `Jcs.deepEqual` canonicalizes both sides (records via Jackson) and compares the text.

**Alternatives.** `JsonNode.equals` with a numeric comparator (still differs from TS for `1` vs `1.0`).

**Consequences.** Same verdicts as TS for every JSON-representable value.

**Reverse.** Swap the comparison in `ExactCardanoServerScheme`.
