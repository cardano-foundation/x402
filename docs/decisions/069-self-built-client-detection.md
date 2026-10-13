# 069 — How self-built `RestClient` / `RestTemplate` beans are recognized

**Context.** Plan §2: Boot-built clients carry a marker and are skipped; self-built ones get a warning; clients built with `x402Decorator.decorate(factory)` should not be warned about. Spring exposes no getter for a `RestClient`'s factory.

**Decision.** A no-op `ClientHttpRequestInitializer` (`X402ClientBeanPostProcessor.MARKER`) is added by a `RestClientCustomizer` / `RestTemplateCustomizer`; `RestClient.mutate().requestInitializers(list -> …)` and `RestTemplate.getClientHttpRequestInitializers()` read it back through public API. A decorated factory is recognized by reading the private `requestFactory` field (`DefaultRestClientBuilder`, `HttpAccessor`) via `ReflectionUtils`; if Spring renames it, the check returns "not decorated" and the bean is merely warned about (never modified).

**Alternatives.** Always warn (false warnings for the documented fix); wrap the factory reflectively (the plan rules it out: settings could be lost).

**Reverse.** Drop the reflective read; keep the marker.
