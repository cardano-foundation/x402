# 194 — WP10 review fixes: clean client build, JDK/Maven prerequisite, typed catalog `extra`

**Context.** WP10 review items 3, 5 and 6.

**Decision.**
- **Clean client build.** `e2e/clients/java/http/java-http/build.sh` runs `mvn -q clean package`, so jars from an older dependency set never stay in `target/lib`. `run.sh` puts all of `target/lib/*` on the classpath.
- **Prerequisite.** The `e2e/README.md` setup section states that the Java components need JDK 17+ and Maven on `PATH`; otherwise `setup.sh` reports them as failed.
- **Typed `extra`.** `E2eServerConfig.flatten` keeps JSON types for catalog `requirementsExtra` / `schemeExtra`:
  - booleans → `Boolean`;
  - integers → `Long` (`BigInteger` beyond long);
  - other numbers → `BigDecimal`;
  - arrays → one `List` value;
  - objects still flatten into nested keys.

  Spring's `Map<String, Object>` binding passes default-property objects through. An index-keyed array (`x[0]`, `x[1]`) would instead bind as a map `{"0": …}` (decision 141).

**Evidence.** I used a scratch catalog whose default route has `requirementsExtra {e2eFlag: true, e2eCount: 7, e2eRatio: 1.5, e2eNested: {n: 2, s: "x"}, e2eList: [1, "a"]}`. Its 402 `extra` carries exactly those JSON types. Before the fix, arrays came out as `{"0":1,"1":"a"}`, and scalars were strings.

**Consequences.** No current Java catalog route has `requirementsExtra` or `schemeExtra`. This only protects future routes.

**Reverse.** Revert the three edits.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
