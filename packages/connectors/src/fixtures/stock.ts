/** Génération déterministe des niveaux de stock des bouchons. */
export function hashInt(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Quantité pseudo-aléatoire stable pour (sku, emplacement), avec ~25 % de ruptures. */
export function baseQuantity(sku: string, locationId: string, max: number): number {
  const h = hashInt(`${sku}@${locationId}`);
  return h % 4 === 0 ? 0 : h % (max + 1);
}

export const FIXTURE_DATE = "2026-10-08T07:30:00.000Z";
