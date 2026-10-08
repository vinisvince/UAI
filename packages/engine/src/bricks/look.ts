/**
 * Brique Look : compléter une tenue avec des articles compatibles EN STOCK.
 * Candidats (recommandations + catalogue) → une seule lecture de stock groupée (L1) → règles.
 */
import type { Category, CustomerContext, ToolInput, ToolOutput, UiBlock } from "@uai/contracts";
import type { RequestScope } from "@uai/core";
import type { SourceGateway } from "@uai/connectors";
import { getProduct, getProducts, onlineStock, toProductV1 } from "../catalog.js";
import { diversify, rank } from "../rules.js";

export async function completeLook(
  gateway: SourceGateway,
  scope: RequestScope,
  input: ToolInput<"complete_look">,
  ctx?: CustomerContext,
): Promise<{ data: ToolOutput<"complete_look">; ui: UiBlock | null }> {
  const tenant = scope.tenant;
  const anchor = await getProduct(gateway, scope, input.productId);
  const complements = tenant.rules.look.complements[anchor.category] ?? [];
  scope.addReason("R-LOOK-COMPLEMENTS", `Catégories associées à « ${anchor.category} » : ${complements.join(", ")}.`);

  // Candidats : recommandations de la plateforme + recherche par catégorie complémentaire, en parallèle.
  const [reco, ...searches] = await Promise.all([
    gateway.call(scope, "reco.related", { productId: anchor.id, limit: 8 }),
    ...complements.map((c) => gateway.call(scope, "catalog.search", { text: c, category: c as Category, limit: 4 })),
  ]);
  const ids = [
    ...(reco.ok ? reco.value.productIds : []),
    ...searches.flatMap((s) => (s.ok ? s.value.productIds : [])),
  ].filter((id) => id !== anchor.id);

  const candidates = (await getProducts(gateway, scope, [...new Set(ids)])).filter((p) => complements.includes(p.category));
  const stock = await onlineStock(gateway, scope, candidates);
  if (!stock) scope.addReason("R-LOOK-NOSTOCK", "Stock en ligne indisponible : articles proposés sans garantie de disponibilité.");

  const ranked = rank({ tenant, candidates, stock, ctx, anchor });
  const picked = diversify(ranked, tenant.rules.look.maxItems);
  const size = ctx?.profile?.usualSize;

  return {
    data: {
      productId: anchor.id,
      ...(size ? { size } : {}),
      items: picked.map((s) => ({
        product: toProductV1(s.product, stock, tenant),
        ...(s.inStockInSize !== undefined ? { inStockInSize: s.inStockInSize } : {}),
        reasons: s.reasons.length ? s.reasons : ["Associé à cet article par la marque"],
      })),
    },
    ui: picked.length ? { component: "ProductCarousel", props: { heading: "look", productIds: picked.map((s) => s.product.id) } } : null,
  };
}
