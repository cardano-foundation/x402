# 066 — Re-sync backoff properties; sync runs before the web server starts

**Context.** Plan §1b fixes exponential backoff with a 60 s maximum but no start value; `StartupSyncTest` needs short delays. Requests before the first sync would hit core's "initialize first" error.

**Decision.** New keys `x402.sync.initial-backoff` (default 1 s) and `x402.sync.max-backoff` (default 60 s). `X402ServerLifecycle` (`SmartLifecycle`, phase `Integer.MAX_VALUE - 4096`) runs the startup sync before Boot's `WebServerStartStopLifecycle`. The single-thread scheduler makes at most one re-sync in flight; requests never trigger a sync. After a successful re-sync the scheduler stops. A startup failure of a facilitator no route needs is logged once and never retried (TS parity). If every facilitator fails (core's retryable "no supported payment kinds"), the app starts with every route at 503 and re-syncs.

**Alternatives.** Hard-coded 1 s start (untestable within the 100 ms concurrency budget).

**Reverse.** Remove the two keys and use constants.
