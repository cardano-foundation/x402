# 011 — Numeric money is `BigDecimal`, never `double`

**Context.** TS `parseMoney` accepts `string | number` and renders numbers via `Number#toString` plus an exponent expansion. Java's `Double.toString` differs between JDK 17 and 19+ (shortest-repr change), so a `double` API would give different strings on the CI JDK (17) and newer JDKs.

**Decision.** The Java API takes `String` money or `BigDecimal` (`Amounts.parseMoney(BigDecimal)`, `Money.of(BigDecimal)`), rendered with `stripTrailingZeros().toPlainString()`. No `double` overloads. The TS number fixtures (0.01, 1500, 1e21, 1e-7, -1) pass through `BigDecimal`.

**Alternatives.** `double` overloads with a JS-compatible formatter (complex; easy to get subtly wrong).

**Consequences.** Callers holding a `double` must convert explicitly, which makes the precision decision visible.

**Reverse.** Add overloads later; additive.
