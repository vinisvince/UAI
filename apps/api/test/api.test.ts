import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRuntime } from "@uai/engine";
import { MockLlm } from "@uai/chat";
import { buildApp } from "../src/app.js";

const { app, runtime } = buildApp({ runtime: createRuntime({ simulation: "instant" }), llm: new MockLlm(), demoMode: true });
beforeAll(() => app.ready());
afterAll(() => app.close());

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url, payload: body as object, headers: { "content-type": "application/json", ...headers } });

describe("API REST v1", () => {
  it("401 sans clé, 401 avec une clé inconnue", async () => {
    expect((await post("/v1/tools/search_products", { query: "pull" })).statusCode).toBe(401);
    expect((await post("/v1/tools/search_products", { query: "pull" }, { "x-api-key": "nope" })).statusCode).toBe(401);
  });

  it("un tenantId dans le corps n'a aucun effet : le client vient de la clé (S3)", async () => {
    const r = await post("/v1/tools/search_products", { query: "pull", tenantId: "maison-lune" }, { "x-api-key": "pk_celio_partner_demo" });
    expect(r.statusCode).toBe(400);
  });

  it("clé Maison Lune + session Célio : refusé (S3)", async () => {
    const token = runtime.issueDemoSession("celio", "c-1001");
    const r = await post("/v1/tools/check_store_stock", { productId: "shp-9001" }, { "x-api-key": "fk_lune_shop_demo", authorization: `Bearer ${token}` });
    expect(r.statusCode).toBe(401);
  });

  it("réponse justifiée : données, raisons, sources, budget", async () => {
    const r = await post("/v1/tools/check_store_stock", { productId: "CEL-CH-OXFORD-BLEU", size: "M" }, { "x-api-key": "pk_celio_partner_demo" });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body).toMatchObject({ tool: "check_store_stock", version: "v1", partial: false, rulesVersion: "celio-rules-2026.10.1" });
    expect(body.sources.map((s: { connector: string }) => s.connector)).toContain("sfcc-oci");
    expect(body.meta.budgetMs).toBe(450);
  });

  it("liste des outils selon le niveau", async () => {
    const pub = (await app.inject({ url: "/v1/tools", headers: { "x-api-key": "pk_celio_partner_demo" } })).json();
    expect(pub.tools.map((t: { name: string }) => t.name)).toEqual(["search_products", "check_store_stock", "complete_look"]);
  });

  it("OpenAPI publié", async () => {
    const doc = (await app.inject({ url: "/v1/openapi.json" })).json();
    expect(Object.keys(doc.paths)).toHaveLength(8);
  });

  it("couche indisponible : 503 propre, le front garde son contenu standard", async () => {
    await post("/demo/simulation", { layerDown: true });
    expect((await post("/v1/tools/search_products", { query: "pull" }, { "x-api-key": "pk_celio_partner_demo" })).statusCode).toBe(503);
    await post("/demo/simulation", { reset: true });
  });

  it("chat de bout en bout avec session de démonstration", async () => {
    const s = (await post("/demo/session", { externalId: "c-1001" }, { "x-api-key": "fk_celio_site_demo" })).json();
    const r = await post("/v1/chat", { message: "Est-ce dispo en magasin ?", page: { productId: "CEL-CH-OXFORD-BLEU" } }, { "x-api-key": "fk_celio_site_demo", authorization: `Bearer ${s.token}` });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ aiGenerated: true, ui: { component: "StoreStock" } });
  });
});
