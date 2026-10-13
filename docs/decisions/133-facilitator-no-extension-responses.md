# 133 — The facilitator handler never writes the `extensionResponses` side channel

**Context.** Core `VerifyResponse` and `SettleResponse` carry `extensionResponses`, a server-internal field that `HttpFacilitatorClient` fills from the `EXTENSION-RESPONSES` header. The plan says the handler emits no such header, because no Java extension produces facilitator responses yet. Serializing the records unchanged would put the field into the JSON body, where no client schema reads it.

**Decision.** The handler and `LocalFacilitatorClient` drop `extensionResponses` from verify and settle results: settle uses `withoutExtensionResponses()` and verify uses an equivalent copy. `extensions` and `extra` are kept.

**Consequences.** HTTP and local answers stay identical (decision 131). If a facilitator scheme sets the field, it is lost on both paths alike.

**Reverse.** When a Java facilitator extension produces responses, encode them as the base64 `EXTENSION-RESPONSES` header (TS `httpFacilitatorClient.ts:262-274`) and keep them in the local result.

Taken under the user's standing instruction (2026-10-12) to take the recommended path without asking.
