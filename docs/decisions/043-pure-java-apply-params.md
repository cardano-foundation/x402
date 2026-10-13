# 043 — Plutus parameter application in pure Java; validator code as a Java constant

**Context.** Script and Masumi escrow addresses require applying parameters to a compiled UPLC program. The lifted facilitator uses `aiken-java-binding`, a native library without a Linux ARM64 build, which is not a managed dependency; WP7 may not add compile dependencies. The Masumi validator ships as a resource there; WP7's allowed files cover Java sources only.

**Decision.** `exact.script.FlatApplier` ports the Go branch's bit-level `flat.go`: terms are copied bit for bit and the data constants appended, byte-identical to Aiken and Evolution. The compiled `vested_pay` validator is a Java string constant (`MasumiBlueprintCode`, behind an accessor so the 20 KB literal is not inlined). Verified by `MasumiDigestVectorsTest`: default and custom escrow addresses, ten script-hash vectors covering every parameter type.

**Alternatives.** aiken-java-binding (native, platform-limited); decoding to a UPLC AST and re-encoding (the Go port found this loses the element type of empty lists).

**Consequences.** No native code; works on every JVM platform.

**Reverse.** Swap `FlatApplier.applyParams` for another implementation; the vectors keep it honest.
