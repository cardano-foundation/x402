# 094 — JS defaults and truthiness are mapped to Java null and a truthiness helper

**Context.** TS destructuring defaults (`input = {}`, `inputSchema = {properties: {}}`) apply to `undefined` only, and `output?.example` is tested for truthiness.

**Decision.** In Java an unset or `null` `input`/`inputSchema` takes the default (TS distinguishes explicit `null`; that case is not reachable from Java and not exported). `output.example` that is `null`, `false`, `0`, `NaN` or `""` omits the whole output, like TS (vector "falsy example omits output").

**Alternatives.** Treat only `null` as absent.

**Consequences.** A `0` or `false` example cannot be declared, same as TS.

**Reverse.** Replace the truthiness helper in `Bazaar`.
