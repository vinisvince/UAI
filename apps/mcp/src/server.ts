import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRuntime } from "@uai/engine";
import { createMcpServer } from "./server-factory.js";

const apiKey = process.env.UAI_API_KEY ?? "pk_celio_partner_demo";
const server = createMcpServer(createRuntime(), apiKey);
await server.connect(new StdioServerTransport());
console.error("Serveur MCP UA Intelligence prêt (stdio).");
