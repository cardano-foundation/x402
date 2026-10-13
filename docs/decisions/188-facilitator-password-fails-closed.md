# 188 — The example facilitator refuses to start without a usable password

**Context.** Independent review of WP11, finding B1: `spring.security.user.password: "${FACILITATOR_PASSWORD}"` in the example's YAML. Spring Boot's property binding keeps an unresolvable placeholder as literal text, so the review expected the facilitator to start with the publicly known password `${FACILITATOR_PASSWORD}`.

What a test showed (red first, Boot 3.5.16):
- **Unset variable:** startup already failed, but only by accident. `ReactiveUserDetailsServiceAutoConfiguration`'s condition resolves the placeholder strictly ("Could not resolve placeholder 'FACILITATOR_PASSWORD'"). A different Boot version or auto-configuration order could change that.
- **Blank password** (`FACILITATOR_PASSWORD=""` or spaces): the facilitator **started**, and HTTP Basic with an empty password would authenticate. Two of the three new test cases were red for this reason.

**Decision.**
- `spring.security.user.*` is removed from the example's YAML.
- `SecurityConfig` defines the user itself: `UserDetailsService facilitatorUser(@Value("${FACILITATOR_USER:x402}") user, @Value("${FACILITATOR_PASSWORD}") password)`. `@Value` resolves strictly, so an unset variable fails startup by design, not through a condition.
- A blank password, or one that still contains `${`, throws `IllegalStateException("FACILITATOR_PASSWORD must be set to a non-blank value")`.
- The password is stored BCrypt-encoded (`PasswordEncoderFactories.createDelegatingPasswordEncoder()`) in an `InMemoryUserDetailsManager`.

Tests in `FacilitatorExampleTest`: `withoutAPasswordTheFacilitatorDoesNotStart`, and `aBlankOrPlaceholderPasswordIsRefused` with `""`, `"   "` and `"${FACILITATOR_PASSWORD}"`. A first draft also had a `${OTHER:x}` case; it was wrong (that resolves to `x`) and was dropped before the fix.

**Alternatives.** Keep the YAML and add a startup check bean (two places describe one user); a `@Validated` properties class (more code for one value).

**Consequences.** The walkthrough's `export FACILITATOR_PASSWORD=…` is now enforced. Decision 182 is amended.

**Reverse.** Restore `spring.security.user.*` in the YAML and drop the bean (reopens the blank-password start).

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
