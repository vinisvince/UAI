import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRuntime } from "@uai/engine";
import { createMcpServer } from "../src/server-factory.js";

describe("Serveur MCP public", () => {
  it("n'expose que les outils publics, en lecture seule", async () => {
    const rt = createRuntime({ simulation: "instant" });
    const server = createMcpServer(rt, "pk_celio_partner_demo");
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(b);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["check_store_stock", "complete_look", "search_products"]);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);

    const r = await client.callTool({ name: "check_store_stock", arguments: { productId: "CEL-CH-OXFORD-BLEU" } });
    const payload = JSON.parse((r.content as { text: string }[])[0]!.text);
    expect(payload.data.productId).toBe("CEL-CH-OXFORD-BLEU");
    expect(rt.journal.list("celio")[0]?.channel).toBe("mcp");
  });

  it("refuse une clé de service (niveau interne)", () => {
    const rt = createRuntime({ simulation: "instant" });
    expect(() => createMcpServer(rt, "fk_celio_site_demo")).not.toThrow(); // clé front sans session = public
    expect(() => createMcpServer(rt, "sk_celio_sav_demo")).toThrow();
  });
});
