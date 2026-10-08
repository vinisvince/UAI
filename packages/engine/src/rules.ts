/**
 * Moteur de règles explicables : chaque point de score vient d'une règle
 * nommée, configurée par client, et produit une raison lisible.
 */
import type { CustomerContext, InventoryLevel, Product } from "@uai/contracts";
import type { TenantConfig } from "@uai/core";
import { statusOf, variantFor } from "./catalog.js";

export interface Scored {
  product: Product;
  score: number;
  reasons: string[];
  ruleIds: string[];
  inStockInSize?: boolean;
  excluded?: string;
}

export interface RankInput {
  tenant: TenantConfig;
  candidates: Product[];
  stock: Map<string, InventoryLevel> | undefined;
  ctx?: CustomerContext;
  anchor?: Product;
}

const SIZELESS = new Set(["chaussures", "accessoire"]);

export function rank({ tenant, candidates, stock, ctx, anchor }: RankInput): Scored[] {
  const w = tenant.rules.ranking;
  const size = ctx?.profile?.usualSize;
  const isMember = Boolean(ctx?.loyalty && ctx.loyalty.tier !== "none");
  const recent = new Set(ctx?.history?.recentCategories ?? []);

  return candidates
    .map((product): Scored => {
      const s: Scored = { product, score: 0, reasons: [], ruleIds: [] };
      const add = (id: string, points: number, reason: string) => {
        s.score += points;
        s.ruleIds.push(id);
        s.reasons.push(reason);
      };

      // Disponibilité : en stock dans la taille habituelle, sinon au moins une taille.
      const qty = (sku?: string) => (sku && stock ? stock.get(sku)?.quantity ?? 0 : 0);
      const v = SIZELESS.has(product.category) ? undefined : variantFor(product, size);
      const anyInStock = stock ? product.variants.some((x) => statusOf(qty(x.sku), tenant) !== "out") : true;
      if (v) {
        s.inStockInSize = stock ? statusOf(qty(v.sku), tenant) !== "out" : undefined;
        if (s.inStockInSize) add("R-RANK-SIZE-STOCK", w.inSizeStock, `En stock dans votre taille (${v.size})`);
      }
      if (!anyInStock) s.excluded = "rupture";

      if (anchor) {
        const shared = product.styleTags.filter((t) => anchor.styleTags.includes(t) && t !== w.loyaltyExclusiveTag);
        if (shared.length) add("R-RANK-STYLE", w.styleMatch, `Même style : ${shared.join(", ")}`);
      }
      if (ctx?.profile?.fit && product.fit === ctx.profile.fit) add("R-RANK-FIT", w.fitMatch, `Coupe ${product.fit}, votre préférence`);
      if (recent.has(product.category)) add("R-RANK-HISTORY", w.recentCategory, "Catégorie que vous achetez souvent");

      if (w.loyaltyExclusiveTag && product.styleTags.includes(w.loyaltyExclusiveTag)) {
        if (isMember) add("R-RANK-LOYALTY", w.loyaltyExclusive, "Réservé aux membres du programme de fidélité");
        else s.excluded = "exclusif-membres";
      }
      return s;
    })
    .filter((s) => !s.excluded)
    .sort((a, b) => b.score - a.score || a.product.price.amount - b.product.price.amount);
}

/** Une pièce par catégorie d'abord, pour composer une tenue. */
export function diversify(scored: Scored[], max: number): Scored[] {
  const picked: Scored[] = [];
  const seen = new Set<string>();
  for (const s of scored) if (!seen.has(s.product.category) && picked.length < max) {
    picked.push(s);
    seen.add(s.product.category);
  }
  for (const s of scored) if (picked.length < max && !picked.includes(s)) picked.push(s);
  return picked;
}
