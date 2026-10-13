# 098 — Core reserves the identifier `local`

**Context.** Review finding O4. Plan §1b reserves `local` for the in-process facilitator (WP12), but core accepted any client named `local`, so a remote entry could take the name pins and health use for the in-process one.

**Decision.**
- New marker `org.x402.core.InProcessFacilitatorClient extends FacilitatorClient` (additive).
- `X402ResourceServer.Builder.localFacilitator(client)` registers the in-process facilitator first, under `local`, whatever `client.identifier()` returns; a second call throws `IllegalStateException`.
- A client added with `facilitator(...)`/`facilitators(...)` whose normalized identifier is `local` throws `IllegalArgumentException` unless it implements the marker.
- WP12's `LocalFacilitatorClient` should implement the marker and be registered with `localFacilitator(...)`.
- The test fake `FakeFacilitatorClient` implements the marker (it is in-process), so the existing "pin to the generated `local` entry" case in `RouteValidationTest` keeps modelling the in-process client. No assertion changed.

Test: `ReservedLocalFacilitatorTest`.

**Reverse.** Remove the check in `Builder.build()`.
