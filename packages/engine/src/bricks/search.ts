/** Recherche produits (public) et recommandations classées (session). */
import { Category, type CustomerContext, type ToolInput, type ToolOutput, type UiBlock } from "@uai/contracts";
import type { RequestScope } from "@uai/core";
import type { SourceGateway } from "@uai/connectors";
import { getProducts, onlineStock, toProductV1 } from "../catalog.js";
import { rank } from "../rules.js";

const asCategory = (c?: string) => (c && Category.safeParse(c).success ? (c as Category) : undefined);

export async function searchProducts(
  gateway: SourceGateway,
  scope: RequestScope,
  input: ToolInput<"search_products">,
): Promise<{ data: ToolOutput<"search_products">; ui: UiBlock | null }> {
  const r = await gateway.call(scope, "catalog.search", {
    text: input.query,
    category: asCategory(input.filters?.category),
    maxPrice: input.filters?.maxPrice,
    limit: input.limit ?? 6,
  });
  const ids = r.ok ? r.value.productIds : [];
  const products = await getProducts(gateway, scope, ids);
  const stock = await onlineStock(gateway, scope, products);
  const list = products.map((p) => toProductV1(p, stock, scope.tenant));
  return {
    data: { products: list },
    ui: list.length ? { component: "ProductCarousel", props: { heading: "search", productIds: list.slice(0, 8).map((p) => p.id) } } : null,
  };
}

export async function recommendProducts(
  gateway: SourceGateway,
  scope: RequestScope,
  input: ToolInput<"recommend_products">,
  ctx?: CustomerContext,
): Promise<{ data: ToolOutput<"recommend_products">; ui: UiBlock | null }> {
  const category = asCategory(input.intent.category);
  const text = [input.intent.category, input.intent.occasion].filter(Boolean).join(" ");
  const r = await gateway.call(scope, "catalog.search", { text, category, maxPrice: input.intent.budgetMax, limit: 12 });
  const products = await getProducts(gateway, scope, r.ok ? r.value.productIds : []);
  const stock = await onlineStock(gateway, scope, products);
  const ranked = rank({ tenant: scope.tenant, candidates: products, stock, ctx }).slice(0, input.limit ?? 4);
  if (input.intent.budgetMax) scope.addReason("R-RECO-BUDGET", `Budget maximum ${input.intent.budgetMax} € respecté.`);
  return {
    data: {
      items: ranked.map((s) => ({ product: toProductV1(s.product, stock, scope.tenant), score: s.score, reasons: s.reasons })),
    },
    ui: ranked.length ? { component: "ProductCarousel", props: { heading: "recommendations", productIds: ranked.map((s) => s.product.id) } } : null,
  };
}
