import { describe, expect, it } from "vitest";
import { InventoryLevel, Product } from "@uai/contracts";
import { RequestScope, MemoryStore, TenantCache, TenantRegistry } from "@uai/core";
import {
  ConnectorRegistry,
  DEFAULT_SIMULATION,
  SimulationControl,
  SourceGateway,
  celioFixtures,
  luneFixtures,
  normalizeOciRecord,
  normalizeScapiProduct,
  normalizeShopifyInventory,
  normalizeShopifyProduct,
  shopifyIds,
} from "../src/index.js";
import { DEFAULT_CONFIG_DIR } from "../../engine/src/runtime.js";

const at = new Date().toISOString();

describe("Tests de contrat des normaliseurs", () => {
  it("SCAPI → modèle commun", () => {
    for (const raw of celioFixtures.CELIO_PRODUCTS) expect(() => Product.parse(normalizeScapiProduct(raw, at))).not.toThrow();
  });
  it("Shopify Storefront → modèle commun", () => {
    for (const raw of luneFixtures.LUNE_PRODUCTS) {
      const p = normalizeShopifyProduct(raw, at);
      expect(() => Product.parse(p)).not.toThrow();
      expect(shopifyIds.productGid(p.id)).toBe(raw.id);
    }
  });
  it("OCI et Shopify Admin → niveaux de stock, sans quantité négative", () => {
    const oci = normalizeOciRecord({ sku: "X", locationId: "online", onHand: 0, ato: -3, effectiveDate: at });
    expect(InventoryLevel.parse(oci).quantity).toBe(0);
    const v = luneFixtures.LUNE_PRODUCTS[0]!.variants.nodes[0]!.id;
    const l = normalizeShopifyInventory(luneFixtures.shopifyInventoryLevel(v, "gid://shopify/Location/1"));
    expect(l.locationId).toBe("online");
    expect(l.sku).toBe(shopifyIds.variant(v));
  });
});

describe("Passerelle vers les sources", () => {
  const setup = () => {
    const tenants = TenantRegistry.fromDirectory(DEFAULT_CONFIG_DIR);
    const sim = new SimulationControl(DEFAULT_SIMULATION);
    sim.instant = true;
    const registry = new ConnectorRegistry(tenants.list(), sim);
    const gateway = new SourceGateway(registry, new TenantCache(new MemoryStore()));
    const caller = (id: string) => ({ tenant: tenants.get(id)!, level: "public" as const, keyLabel: "t", keyKind: "public" as const });
    return { sim, registry, gateway, caller };
  };

  it("résout une capacité dans l'ordre de préférence du client", () => {
    const { registry } = setup();
    expect(registry.forCapability("celio", "catalog.search")?.id).toBe("algolia-mcp");
    expect(registry.forCapability("maison-lune", "catalog.search")?.id).toBe("shopify-storefront");
    expect(registry.forCapability("maison-lune", "fit.recommend")).toBeUndefined();
  });

  it("une capacité absente est listée comme manquante, sans erreur", async () => {
    const { gateway, caller } = setup();
    const scope = new RequestScope(caller("maison-lune"), 500);
    const r = await gateway.call(scope, "fit.recommend", { productId: "shp-9001" });
    expect(r).toEqual({ ok: false, reason: "missing" });
    expect([...scope.missing]).toContain("fit.recommend");
  });

  it("une source trop lente est coupée à son budget et marquée partielle", async () => {
    const { gateway, caller, sim } = setup();
    sim.instant = false;
    sim.configure("sf-oms-mulesoft", { latencyMs: [500, 500] });
    const scope = new RequestScope(caller("celio"), 1000);
    const started = performance.now();
    const r = await gateway.call(scope, "orders.history.read", { externalId: "MULE-CUST-5512" });
    expect(r).toMatchObject({ ok: false, reason: "timeout" });
    expect(performance.now() - started).toBeLessThan(450);
    expect(scope.partial).toBe(true);
  });

  it("une source en panne ne lève pas d'erreur : réponse partielle", async () => {
    const { gateway, caller, sim } = setup();
    sim.configure("sfcc-oci", { down: true });
    const scope = new RequestScope(caller("celio"), 500);
    const r = await gateway.call(scope, "inventory.online.read", { skus: ["CEL-CH-OXFORD-BLEU-M"] });
    expect(r.ok).toBe(false);
    expect(scope.partial).toBe(true);
  });

  it("le cache évite un second appel à la source", async () => {
    const { gateway, caller, sim } = setup();
    const scope = new RequestScope(caller("celio"), 500);
    await gateway.call(scope, "catalog.get", { productIds: ["CEL-CH-OXFORD-BLEU"] });
    await gateway.call(scope, "catalog.get", { productIds: ["CEL-CH-OXFORD-BLEU"] });
    expect(sim.calls.get("sfcc-scapi")).toBe(1);
    expect(scope.timings.map((t) => t.cache)).toEqual(["miss", "hit"]);
  });
});
