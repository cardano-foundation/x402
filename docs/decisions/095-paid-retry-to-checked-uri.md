# 095 — With a `HostPolicy`, the paid retry goes to the URI that answered 402

**Context.** Review finding B1. `X402HttpClient` checked the host that answered 402 (after the redirects it followed) and `resource.url`, but rebuilt the signed retry from the *original* request. A first host off the policy that redirects to an allowed paywall therefore received `PAYMENT-SIGNATURE`. Retrying the original request also clashes with decision 012: a cross-origin hop strips the signature, so an allowed A → allowed B chain would never deliver the payment.

**Decision.** With a `HostPolicy`, the signed retry is built from the last request of the unpaid exchange (the one whose response was the 402) and sent to that URI, which the policy has already allowed. The body is the recorded one if that request still carried it; a hop converted to GET sends none. Headers are those of that last request, so credentials stripped on a cross-origin hop stay stripped. The returned response's `previousResponse()` chain includes the earlier redirects and the unpaid 402. Without a `HostPolicy`, the TS behaviour stays: the original request is retried and the delegate follows redirects. Also (finding O3): a body with `contentLength() == 0` is always replayable, because the JDK may never subscribe to an empty publisher. Tests: `X402HttpClientPaidRetryTest`.

**Alternatives.** Also require the original host to be allowed and keep retrying the original request (still blocked by decision 012 for allowed cross-origin chains).

**Consequences.** A paywall reached through a redirect is paid directly; TS would replay the whole chain.

**Reverse.** Use `first` instead of `unpaid.last()` in `X402HttpClient.pay` and add an `allows(first.uri())` check.
