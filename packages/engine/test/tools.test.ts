import { beforeEach, describe, expect, it } from "vitest";
import { createRuntime, type Runtime } from "../src/index.js";

let rt: Runtime;
beforeEach(() => {
  rt = createRuntime({ simulation: "instant" });
});

const front = (tenant: "celio" | "maison-lune", externalId?: string) =>
  rt.authenticate({
    apiKey: tenant === "celio" ? "fk_celio_site_demo" : "fk_lune_shop_demo",
    ...(externalId ? { sessionToken: rt.issueDemoSession(tenant, externalId) } : {}),
  });

describe("Portabilité : mêmes outils sur Salesforce et Shopify", () => {
  it.each([
    ["celio", "CEL-CH-OXFORD-BLEU", "c-1001"],
    ["maison-lune", "shp-9001", "gid://shopify/Customer/7001"],
  ] as const)("%s : stock, tenue et recherche répondent au même contrat", async (tenant, productId, customer) => {
    const caller = front(tenant, customer);
    const stock = await rt.executor.execute("check_store_stock", { productId }, caller);
    expect(stock.data).toHaveProperty("online.status");
    expect(stock.ui?.component).toBe("StoreStock");
    const look = await rt.executor.execute("complete_look", { productId }, caller);
    expect((look.data as { items: unknown[] }).items.length).toBeGreaterThan(0);
    const search = await rt.executor.execute("search_products", { query: "pull" }, caller);
    expect((search.data as { products: unknown[] }).products.length).toBeGreaterThan(0);
  });

  it("Fit : spécialiste chez Célio, profil chez Maison Lune (capacité absente signalée)", async () => {
    const celio = await rt.executor.execute("recommend_size", { productId: "CEL-PA-CHINO-BEIGE" }, front("celio", "c-1001"));
    expect(celio.data).toMatchObject({ source: "fit-specialist", size: "M" });
    const lune = await rt.executor.execute("recommend_size", { productId: "shp-9001" }, front("maison-lune", "gid://shopify/Customer/7001"));
    expect(lune.data).toMatchObject({ source: "profile", size: "S" });
    expect(lune.missing).toContain("fit.recommend");
  });
});

describe("Niveaux d'accès et entrées", () => {
  it("un outil session est refusé au niveau public, un outil interne au niveau session", async () => {
    await expect(rt.executor.execute("recommend_size", { productId: "CEL-CH-OXFORD-BLEU" }, front("celio"))).rejects.toMatchObject({ code: "forbidden" });
    await expect(rt.executor.execute("get_customer_summary", { customerRef: "x" }, front("celio", "c-1001"))).rejects.toMatchObject({ code: "forbidden" });
  });

  it("un customerId dans les arguments est refusé (S1, S2)", async () => {
    await expect(rt.executor.execute("check_store_stock", { productId: "CEL-CH-OXFORD-BLEU", customerId: "c-1002" }, front("celio", "c-1001"))).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("un produit d'un autre client est introuvable (S3)", async () => {
    await expect(rt.executor.execute("check_store_stock", { productId: "shp-9001" }, front("celio"))).rejects.toMatchObject({ code: "not_found" });
  });

  it("le service client consulte un résumé avec rôle et motif, journalisés", async () => {
    const pseudo = rt.identity.pseudonymize("celio", "c-1001");
    const sav = rt.authenticate({ apiKey: "sk_celio_sav_demo", role: "sav", motif: "Réclamation livraison" });
    const r = await rt.executor.execute("get_customer_summary", { customerRef: pseudo }, sav);
    expect(r.data).toMatchObject({ firstName: "Thomas", tier: "gold", usualSize: "M", preferredStore: "Célio Paris Rivoli" });
    const entry = rt.journal.list("celio")[0]!;
    expect(entry.caller).toMatchObject({ level: "interne", role: "sav", motif: "Réclamation livraison" });
    expect(entry.customerRef).toBe(pseudo);
  });
});

describe("Consentement et minimisation (S7, L5)", () => {
  it("consentement refusé : aucun champ personnel n'est lu", async () => {
    rt.sim.calls.clear();
    const r = await rt.executor.execute("recommend_size", { productId: "CEL-CH-OXFORD-BLEU" }, front("celio", "c-1003"));
    expect(r.data).toMatchObject({ source: "none" });
    const read = r.meta.timings.map((t) => t.capability);
    expect(read).toContain("consent.read");
    expect(read).not.toContain("customer.profile.read");
    expect(read).not.toContain("orders.history.read");
    expect(rt.journal.list("celio")[0]?.consent).toBe("refused");
  });

  it("la recherche publique ne lit aucune donnée client", async () => {
    const r = await rt.executor.execute("search_products", { query: "chemise" }, front("celio", "c-1001"));
    expect(r.meta.timings.map((t) => t.capability)).not.toContain("consent.read");
  });
});

describe("Latence et dégradation (L1, L2)", () => {
  it("Look : une seule lecture de stock groupée pour tous les candidats", async () => {
    const r = await rt.executor.execute("complete_look", { productId: "CEL-CH-OXFORD-BLEU" }, front("celio", "c-1001"));
    expect(r.meta.timings.filter((t) => t.capability === "inventory.online.read")).toHaveLength(1);
  });

  it("stock indisponible : statut inconnu, réponse partielle, jamais une erreur", async () => {
    rt.sim.configure("sfcc-oci", { down: true });
    const r = await rt.executor.execute("check_store_stock", { productId: "CEL-PA-JEAN-BRUT" }, front("celio"));
    expect(r.partial).toBe(true);
    expect(r.data).toMatchObject({ online: { status: "unknown" }, restockSuggested: false });
  });

  it("exclusivités membres : visibles pour un membre, masquées sinon", async () => {
    const member = await rt.executor.execute("complete_look", { productId: "CEL-CH-OXFORD-BLEU" }, front("celio", "c-1001"));
    const anon = await rt.executor.execute("complete_look", { productId: "CEL-CH-OXFORD-BLEU" }, front("celio"));
    const ids = (r: typeof member) => (r.data as { items: { product: { id: string } }[] }).items.map((i) => i.product.id);
    expect(ids(member)).toContain("CEL-VE-DOUDOUNE-NOIR");
    expect(ids(anon)).not.toContain("CEL-VE-DOUDOUNE-NOIR");
  });
});

describe("Écritures déléguées (D1)", () => {
  it("l'abonnement au réassort est idempotent et vit dans la source", async () => {
    const c = front("celio", "c-1001");
    const a = await rt.executor.execute("subscribe_restock", { productId: "CEL-VE-BLAZER-MARINE", size: "M" }, c);
    const b = await rt.executor.execute("subscribe_restock", { productId: "CEL-VE-BLAZER-MARINE", size: "M" }, c);
    expect(a.data).toEqual(b.data);
    const sfmc = rt.registry.get("celio", "sfmc-restock") as unknown as { subscriptions: Map<string, unknown> };
    expect(sfmc.subscriptions.size).toBe(1);
  });

  it("le lien de panier est signé et ne contient que des SKU validés", async () => {
    const r = await rt.executor.execute("prepare_cart", { items: [{ productId: "shp-9001", size: "S", qty: 2 }] }, front("maison-lune", "gid://shopify/Customer/7001"));
    expect((r.data as { url: string }).url).toMatch(/^https:\/\/maison-lune-demo\.myshopify\.com\/cart\/900102:2\?uai_sig=/);
    await expect(rt.executor.execute("prepare_cart", { items: [{ productId: "shp-9001", size: "XXL", qty: 1 }] }, front("maison-lune", "gid://shopify/Customer/7001"))).rejects.toMatchObject({ code: "invalid_input" });
  });
});
