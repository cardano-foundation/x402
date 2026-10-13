# WP-9b: routes declare bazaar discovery from YAML and it appears in PAYMENT-REQUIRED
Tier: R1
Base: <git rev-parse HEAD at package start>
Check: `BazaarStarterTest` — an offer with `extensions.bazaar` produces the WP9a declaration inside the `PAYMENT-REQUIRED` header, with the HTTP method of the resolved mapping

## Allowed files
- java/x402-spring-boot-autoconfigure/src/main/java/org/x402/spring/extensions/**
- java/x402-spring-boot-autoconfigure/src/test/java/org/x402/spring/extensions/**
- java/x402-spring-boot-autoconfigure/src/main/resources/META-INF/spring/**
- docs/**

## Rules
- Starts after WP5 and WP9a.
- `X402BazaarAutoConfiguration`, `@ConditionalOnClass` on x402-extensions. It registers the extension and maps `x402.routes.<offer>.extensions.bazaar` to the declaration.
- The autoconfigure pom already depends on x402-extensions (WP1 skeleton). No property-class changes: `extensions` already binds as a map in WP5.

## Proof commands
- red-first: ~/.claude/bin/red-first.sh <Base> --setup 'mvn -q -f java/pom.xml install -DskipTests' java/x402-spring-boot-autoconfigure/src/test/java/org/x402/spring/extensions/BazaarStarterTest.java -- mvn -f java/pom.xml -pl x402-spring-boot-autoconfigure test
- green: `mvn -B -f java/pom.xml verify -Pcoverage checkstyle:check spotbugs:check`
- scope: ~/.claude/bin/check-scope.sh docs/work/wp-9b-bazaar-starter.md

## Log
- 2026-10-12 Base: f8f83309 (no checkpoint commits, decision 001); WP5/WP6/WP13 complete in the same tree; x402-extensions from ~/.m2.
- red-first (manual, decision 001): `BazaarStarterTest` (4) written first → `mvn -B -pl x402-spring-boot-autoconfigure test -Dtest=BazaarStarterTest`: 2 failures + 2 errors (the YAML map reached PAYMENT-REQUIRED raw: no `info`/`schema`, no method, no `routeTemplate`; `discoverable: false` not honoured).
- green: `cd java && mvn -B -pl x402-spring-boot-autoconfigure verify -Pcoverage checkstyle:check spotbugs:check` → exit 0, BUILD SUCCESS; Tests run 247, Failures 0, Errors 0 (WP9b Check: BazaarStarterTest 4; coverage test BazaarDeclarationsTest 4, added after implementation, red at Base by non-compilation); jacoco instructions 0.939, branches 0.843; checkstyle 0; spotbugs 0. Decision 151.
- Note: the filters (WP5/WP6 files) now pass the matched Spring pattern to hooks in x402 syntax (decision 151), so `routeTemplate`/`pathParams` work for annotated routes.
- Scope note (review round 2): this package also edited files outside its Allowed list: `org/x402/spring/offer/OfferRegistry.java` (`toRoutePattern`) and both filters (`web/servlet/X402ServletFilter.java`, `web/reactive/X402WebFilter.java`) to hand hooks the matched pattern in x402 syntax (decision 151). Allowed files amended below.
- `BazaarDeclarationsTest` is not red-first: it was written after its code (red at Base by non-compilation only, decision 001).
- Allowed files amendment: java/x402-spring-boot-autoconfigure/src/main/java/org/x402/spring/offer/OfferRegistry.java; java/x402-spring-boot-autoconfigure/src/main/java/org/x402/spring/web/servlet/X402ServletFilter.java; java/x402-spring-boot-autoconfigure/src/main/java/org/x402/spring/web/reactive/X402WebFilter.java.
- scope review (`git status --short -uall -- java/x402-spring-boot-autoconfigure java/x402-spring-boot-starter`, 2026-10-12): every change of this agent is under java/x402-spring-boot-autoconfigure (pom, src/main, src/test, resources); the starter module entries are WP1's staged skeleton; docs only under docs/work and docs/decisions.
