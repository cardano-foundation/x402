# 091 — The MCP tool declaration is ported with the HTTP ones

**Context.** The package names `declareDiscoveryExtension(method, input, output, …)`, but TS routes the same entry point to an MCP builder, the e2e catalog declares MCP routes with it, and `enrichDeclaration` has an explicit MCP branch.

**Decision.** `McpDiscoveryConfig` and the MCP declaration are ported (about 50 lines). Client and facilitator discovery stay out, as the package says.

**Alternatives.** HTTP only, leaving the enrich MCP branch untestable.

**Consequences.** Vectors cover the MCP shapes, including an unknown transport (no `enum`).

**Reverse.** Delete `McpDiscoveryConfig` and its branch in `Bazaar`.
