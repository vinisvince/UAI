/**
 * Serveur MCP public (lecture seule) : catalogue, stock, complétion de tenue.
 * Mêmes outils, mêmes contrats et même exécuteur que l'API REST.
 * Le client servi est déduit de la clé publique, jamais d'un argument.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOL_CATALOG_V1, type ToolName } from "@uai/contracts";
import { UaiError } from "@uai/core";
import { toolsForLevel, type Runtime } from "@uai/engine";

export function createMcpServer(runtime: Runtime, apiKey: string): McpServer {
  const caller = runtime.authenticate({ apiKey });
  if (caller.level !== "public") throw new Error("Le serveur MCP n'accepte qu'une clé publique (niveau Délégué non ouvert).");

  const server = new McpServer({ name: `ua-intelligence-${caller.tenant.id}`, version: "1.0.0" });

  for (const name of toolsForLevel("public") as ToolName[]) {
    const spec = TOOL_CATALOG_V1[name];
    server.registerTool(
      name,
      {
        title: name,
        description: `${spec.description} (${caller.tenant.name})`,
        inputSchema: spec.input,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (args: unknown) => {
        try {
          const r = await runtime.executor.execute(name, args, caller, "mcp");
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ data: r.data, reasons: r.reasons, sources: r.sources, partial: r.partial, missing: r.missing }) }],
          };
        } catch (e) {
          const msg = e instanceof UaiError ? `${e.code}: ${e.message}` : "unavailable";
          return { isError: true, content: [{ type: "text" as const, text: msg }] };
        }
      },
    );
  }
  return server;
}
