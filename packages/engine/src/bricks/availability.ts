/**
 * Brique Availability : stock en ligne et en magasin, par taille, réassort.
 */
import type { CustomerContext, ToolInput, ToolOutput, UiBlock } from "@uai/contracts";
import type { RequestScope } from "@uai/core";
import type { SourceGateway } from "@uai/connectors";
import { bestStatus, getProduct, statusOf } from "../catalog.js";

export async function checkStoreStock(
  gateway: SourceGateway,
  scope: RequestScope,
  input: ToolInput<"check_store_stock">,
  ctx?: CustomerContext,
): Promise<{ data: ToolOutput<"check_store_stock">; ui: UiBlock }> {
  const tenant = scope.tenant;
  const product = await getProduct(gateway, scope, input.productId);
  const sizes = product.variants.map((v) => v.size);

  // Taille : celle demandée, sinon la taille habituelle (session + consentement).
  let size = input.size && sizes.includes(input.size) ? input.size : undefined;
  if (!size && ctx?.profile?.usualSize && sizes.includes(ctx.profile.usualSize)) {
    size = ctx.profile.usualSize;
    scope.addReason("R-AVAIL-SIZE", `Taille habituelle ${size} appliquée (profil client).`);
  }
  const targetSkus = size ? product.variants.filter((v) => v.size === size).map((v) => v.sku) : product.variants.map((v) => v.sku);

  // Trois lectures en parallèle, chacune dans son budget (L1).
  const [online, stores, storeStock] = await Promise.all([
    gateway.call(scope, "inventory.online.read", { skus: product.variants.map((v) => v.sku) }),
    gateway.call(scope, "stores.list", {}),
    gateway.call(scope, "inventory.store.read", { skus: targetSkus }),
  ]);

  const onlineBySku = new Map(online.ok ? online.value.map((l) => [l.sku, l.quantity]) : []);
  const sizeStatuses = product.variants.map((v) => ({
    size: v.size,
    status: online.ok ? statusOf(onlineBySku.get(v.sku) ?? 0, tenant) : ("unknown" as const),
  }));
  if (!online.ok) scope.addReason("R-AVAIL-UNKNOWN", "Stock en ligne momentanément indisponible : statut inconnu, jamais affiché en rupture.");
  const onlineStatus = size
    ? (sizeStatuses.find((s) => s.size === size)?.status ?? "out")
    : bestStatus(sizeStatuses.map((s) => s.status));

  const preferred = ctx?.profile?.preferredStoreId;
  const storeMeta = new Map(stores.ok ? stores.value.map((s) => [s.id, s]) : []);
  const perStore = new Map<string, { qty: number; updatedAt: string }>();
  if (!storeStock.ok || !stores.ok) scope.addReason("R-AVAIL-STORES-DOWN", "Stock magasin momentanément indisponible : réponse partielle.");
  if (storeStock.ok) {
    for (const l of storeStock.value) {
      const prev = perStore.get(l.locationId);
      perStore.set(l.locationId, { qty: (prev?.qty ?? 0) + l.quantity, updatedAt: prev && prev.updatedAt < l.updatedAt ? prev.updatedAt : l.updatedAt });
    }
  }

  const city = input.city?.toLowerCase();
  const rows = [...perStore.entries()]
    .map(([storeId, s]) => {
      const meta = storeMeta.get(storeId);
      return {
        storeId,
        name: meta?.name ?? storeId,
        city: meta?.city ?? "",
        status: statusOf(s.qty, tenant),
        quantity: s.qty,
        preferred: storeId === preferred,
        updatedAt: s.updatedAt,
      };
    })
    .filter((r) => (city ? r.city.toLowerCase().includes(city) : true))
    .sort((a, b) => Number(b.preferred) - Number(a.preferred) || b.quantity - a.quantity)
    .slice(0, tenant.rules.availability.maxStores);

  if (rows.some((r) => r.preferred)) scope.addReason("R-AVAIL-PREF", "Votre magasin préféré est affiché en premier.");
  if (rows.some((r) => r.status === "low")) {
    scope.addReason("R-AVAIL-LOW", `Stock faible : ${tenant.rules.availability.lowStockThreshold} pièces ou moins.`);
  }
  if (rows.length) scope.addReason("R-AVAIL-FRESH", "Stock magasin daté : heure de mise à jour affichée par magasin.");

  const anyStore = rows.some((r) => r.status !== "out");
  const restockSuggested = online.ok && storeStock.ok && onlineStatus === "out" && !anyStore;
  if (restockSuggested) scope.addReason("R-AVAIL-RESTOCK", "Rupture partout : proposer l'alerte de réassort.");

  return {
    data: {
      productId: product.id,
      ...(size ? { size } : {}),
      online: { status: onlineStatus, sizes: sizeStatuses },
      stores: rows,
      restockSuggested,
    },
    ui: { component: "StoreStock", props: { productId: product.id, ...(size ? { size } : {}), storeIds: rows.map((r) => r.storeId) } },
  };
}
