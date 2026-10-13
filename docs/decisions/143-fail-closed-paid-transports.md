# 143 — Fail closed on transports that may follow a paid redirect

**Context.** Security review (2026-10-12, confirmed by the orchestrator). After decisions 075/078, two paths could still sign over a transport that might follow a redirect cross-origin with `PAYMENT-SIGNATURE`:
- the WebClient filter with any connector other than Reactor Netty;
- the 1-argument `x402Decorator.decorate(factory)`.

**Decision.** A payment is signed only when the paid request provably cannot follow a redirect. `TransportRedirects.of(transport)` decides:
- **SAFE**:
  - a JDK `HttpClient` with `Redirect.NEVER` (JDK factory or connector);
  - a Reactor Netty client without a redirect predicate;
  - `SimpleClientHttpRequestFactory`, whose paid `HttpURLConnection` gets `setInstanceFollowRedirects(false)`;
  - Spring factory wrappers are unwrapped first.
- **FOLLOWS**: those clients with redirect following on.
- **UNKNOWN**: anything else.

Outcomes, before anything is signed:
- **FOLLOWS** → the payment is refused with an `X402ClientException`. The thrown exception wraps an inner `X402ClientException` carrying the reason, as the over-cap refusal does, and nothing is sent.
- **UNKNOWN** → the 402 is returned to the caller unpaid, with a WARN naming the fix.

Where the check applies:
- **Blocking, Boot-built:** paid requests use the `DONT_FOLLOW` twin (decision 075); `decorate(factory, twin)` refuses only a twin known to follow redirects.
- **Blocking, `decorate(factory)` (1 argument):** pays only over a SAFE factory. It logs at startup otherwise.
- **Blocking, `decorate(factory, nonRedirectingFactory)`:** refuses only a paid factory known to follow redirects; an unknown one is the caller's explicit assertion.
- **Static `X402ClientHttpRequestFactory.wrap(...)`:** unchecked. The caller asserts the transport, as with plain-Java `X402HttpClient.wrap`. An immutable WP5 Check test (`X402ClientStarterTest#wildcardHostsMatchSubdomainsButNotTheApex…`) pins that `wrap` over an arbitrary factory pays. The Javadoc says so.
- **WebClient:** the transport's safety comes from:
  - the connector of a self-built bean, inspected by `X402WebClientBeanPostProcessor` (`forTransport`);
  - a probe on the first (unpaid) request: Boot's twin connector marks requests with `TWIN_CONNECTOR` → SAFE; a Reactor Netty native request reports `isFollowRedirect()`;
  - FOLLOWS from either source wins; UNKNOWN otherwise. The paid request keeps the Reactor guard from decision 078 as defence in depth.

**Deviation from the requested expectations.** The orchestrator suggested a 402 returned unpaid for a known-following JDK connector or factory. Java refuses with an exception instead. The WP6 Check test `aSelfBuiltRedirectFollowingConnectorNeverCarriesAPaidRequest` (immutable) pins an exception for a known-following Reactor connector, and one rule across stacks and transports is clearer. Both outcomes are fail-closed and sign nothing.

**Tests.** `FailClosedTransportTest` (red first: 5/6). It covers:
- JDK connector NORMAL → refused, nothing signed;
- JDK connector NEVER → paid;
- opaque connector → 402 unpaid + WARN;
- 1-arg decorate over a following JDK factory → refused;
- 1-arg decorate over an opaque factory → 402 unpaid + WARN;
- Simple factory → paid, and the paid redirect is not followed.

**Reverse.** Treat UNKNOWN as SAFE (reopens the leak).

**Addendum (review, same day).** A `SimpleClientHttpRequestFactory` counts as SAFE only when it is the paid factory itself. Behind a wrapper (`BufferingClientHttpRequestFactory`, intercepting factories) the paid request is not the `HttpURLConnection` request, so redirects cannot be switched off: UNKNOWN. `disableOnPaidRequest` reports whether it succeeded; a checked Simple paid factory where it fails refuses to send. `WrappedSimpleFactoryTest` (red first: the second origin received the paid request) pins it.
