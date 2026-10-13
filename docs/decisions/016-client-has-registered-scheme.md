# 016 — `X402Client.hasRegisteredScheme` instead of a message-matching probe

**Context.** Decision 153 registers auto Cardano client schemes only where no customizer scheme answers. Core `X402Client` had no lookup, so the starter probed with a dummy `selectPaymentRequirements` call and matched core's error wording, which would break silently if the message changed.

**Decision.** Core gains `X402Client.hasRegisteredScheme(network, scheme)` for protocol version 2, using the same exact-then-pattern lookup as payment selection (`Networks.findByNetworkAndScheme`). The starter's `ClientSchemes.isRegistered` delegates to it. Tests: `ClientSchemeLookupTest` (red first: the method did not exist) and the existing starter tests. Gates: core 334 tests, starter 277 tests, both exit 0.

**Alternatives.** Keep the probe (fragile).

**Reverse.** Additive API; remove it and restore the probe.
