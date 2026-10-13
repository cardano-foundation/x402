# 005 — One full reference `application.yml`

**Context.** The YAML contract was spread over the plan's contract block, §2 (client) and §3 (facilitator); the user asked to see it in one piece and the shown version drifted (old facilitator map).

**Decision.** The example app `examples/java/servers/spring-boot` ships `application-reference.yml` with every key (server, client, facilitator server), and `ExampleProfilesSmokeTest` binds it with the real `X402Properties` so it cannot drift from the code.

**Alternatives.** Keep only per-section snippets in the README.

**Reverse.** Delete the file and its test.
