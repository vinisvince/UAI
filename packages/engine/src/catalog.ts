/** Accès catalogue et stock communs aux briques, toujours en lecture groupée (L1). */
import type { AvailabilityStatus, InventoryLevel, Product, ProductV1 } from "@uai/contracts";
import { UaiError, type RequestScope, type TenantConfig } from "@uai/core";
import type { SourceGateway } from "@uai/connectors";

export function statusOf(qty: number, tenant: TenantConfig): AvailabilityStatus {
  if (qty <= 0) return "out";
  return qty <= tenant.rules.availability.lowStockThreshold ? "low" : "in_stock";
}

export function bestStatus(statuses: AvailabilityStatus[]): AvailabilityStatus {
  if (statuses.includes("in_stock")) return "in_stock";
  if (statuses.includes("low")) return "low";
  if (statuses.includes("unknown")) return "unknown";
  return "out";
}

export async function getProducts(gateway: SourceGateway, scope: RequestScope, ids: string[]): Promise<Product[]> {
  if (!ids.length) return [];
  const r = await gateway.call(scope, "catalog.get", { productIds: [...new Set(ids)] });
  if (!r.ok) throw new UaiError("unavailable", "Catalogue indisponible.");
  // Conserve l'ordre demandé.
  const byId = new Map(r.value.map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter((p): p is Product => Boolean(p));
}

export async function getProduct(gateway: SourceGateway, scope: RequestScope, id: string): Promise<Product> {
  const [p] = await getProducts(gateway, scope, [id]);
  if (!p) throw new UaiError("not_found", `Produit inconnu : ${id}`);
  return p;
}

/** Stock en ligne de tous les SKU d'une liste de produits : un seul appel. */
export async function onlineStock(gateway: SourceGateway, scope: RequestScope, products: Product[]): Promise<Map<string, InventoryLevel> | undefined> {
  const skus = products.flatMap((p) => p.variants.map((v) => v.sku));
  if (!skus.length) return new Map();
  const r = await gateway.call(scope, "inventory.online.read", { skus });
  if (!r.ok) return undefined;
  return new Map(r.value.map((l) => [l.sku, l]));
}

export function toProductV1(p: Product, stock: Map<string, InventoryLevel> | undefined, tenant: TenantConfig): ProductV1 {
  const online = stock ? bestStatus(p.variants.map((v) => statusOf(stock.get(v.sku)?.quantity ?? 0, tenant))) : undefined;
  return {
    id: p.id,
    title: p.title,
    category: p.category,
    price: p.price,
    color: p.color,
    sizes: p.variants.map((v) => v.size),
    ...(online ? { online } : {}),
  };
}

/** Variante d'une taille donnée, sinon undefined. */
export const variantFor = (p: Product, size?: string) => (size ? p.variants.find((v) => v.size === size) : undefined);
