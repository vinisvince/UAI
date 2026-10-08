/**
 * Données de démonstration : personas, liens d'identité, et « plateforme » côté
 * front (le front résout lui-même prix et visuels, comme il le ferait auprès de
 * SFCC ou Shopify).
 */
import type { IdentityMap } from "@uai/core";
import { CELIO_IDENTITY_LINKS, CELIO_PERSONAS, CELIO_PRODUCTS } from "./fixtures/celio.js";
import { LUNE_IDENTITY_LINKS, LUNE_PERSONAS, LUNE_PRODUCTS } from "./fixtures/lune.js";
import { normalizeScapiProduct } from "./sfcc/index.js";
import { normalizeShopifyProduct } from "./shopify/index.js";

export const DEMO_PERSONAS: Record<string, { externalId: string; label: string }[]> = {
  celio: CELIO_PERSONAS,
  "maison-lune": LUNE_PERSONAS,
};

/** Exécute les règles de rapprochement d'identité du bouchon. */
export function seedIdentity(identity: IdentityMap): void {
  for (const l of CELIO_IDENTITY_LINKS) identity.link("celio", l.commerce, l);
  for (const l of LUNE_IDENTITY_LINKS) identity.link("maison-lune", l.commerce, l);
}

export interface PlatformProduct {
  id: string;
  title: string;
  price: { amount: number; currency: string };
  color: string;
  category: string;
  sizes: string[];
}

/** Ce que le front lirait directement chez la plateforme (hors UA Intelligence). */
export function platformProducts(tenantId: string): PlatformProduct[] {
  const at = new Date().toISOString();
  const list =
    tenantId === "celio"
      ? CELIO_PRODUCTS.map((p) => normalizeScapiProduct(p, at))
      : tenantId === "maison-lune"
        ? LUNE_PRODUCTS.map((p) => normalizeShopifyProduct(p, at))
        : [];
  return list.map((p) => ({ id: p.id, title: p.title, price: p.price, color: p.color, category: p.category, sizes: p.variants.map((v) => v.size) }));
}
