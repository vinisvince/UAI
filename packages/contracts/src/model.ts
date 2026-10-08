/**
 * Modèle interne commun (couche 2 — Normalisation).
 *
 * Chaque connecteur traduit la réponse native de l'éditeur dans ces types.
 * Ce modèle n'est JAMAIS exposé tel quel : les contrats publics (./public/v1)
 * en sont séparés et versionnés (risque D2 du mémo technique).
 */
import { z } from "zod";

export const Money = z.object({
  amount: z.number().nonnegative(),
  currency: z.string().length(3),
});
export type Money = z.infer<typeof Money>;

/** Provenance d'une donnée : système source + horodatage (contrat 1 du mémo). */
export const Provenance = z.object({
  _src: z.string(),
  _at: z.string(), // ISO-8601
});
export type Provenance = z.infer<typeof Provenance>;

export const Category = z.enum([
  "chemise",
  "tshirt",
  "pull",
  "veste",
  "pantalon",
  "chaussures",
  "accessoire",
]);
export type Category = z.infer<typeof Category>;

export const FitType = z.enum(["slim", "regular", "relaxed"]);
export type FitType = z.infer<typeof FitType>;

export const Variant = z.object({
  sku: z.string(),
  size: z.string(),
  color: z.string(),
});
export type Variant = z.infer<typeof Variant>;

export const Product = z
  .object({
    id: z.string(),
    title: z.string(),
    category: Category,
    price: Money,
    color: z.string(),
    fit: FitType.optional(),
    styleTags: z.array(z.string()),
    variants: z.array(Variant).min(1),
  })
  .merge(Provenance);
export type Product = z.infer<typeof Product>;

export const Store = z
  .object({
    id: z.string(),
    name: z.string(),
    city: z.string(),
  })
  .merge(Provenance);
export type Store = z.infer<typeof Store>;

/** Niveau de stock pour un SKU à un emplacement ("online" = stock e-commerce). */
export const InventoryLevel = z
  .object({
    sku: z.string(),
    locationId: z.string(),
    quantity: z.number().int().nonnegative(),
    updatedAt: z.string(),
  })
  .merge(Provenance);
export type InventoryLevel = z.infer<typeof InventoryLevel>;

export const CustomerProfile = z
  .object({
    usualSize: z.string().optional(),
    fit: FitType.optional(),
    segment: z.string().optional(),
    preferredStoreId: z.string().optional(),
    firstName: z.string().optional(),
  })
  .merge(Provenance);
export type CustomerProfile = z.infer<typeof CustomerProfile>;

export const Loyalty = z
  .object({
    tier: z.enum(["none", "member", "silver", "gold"]),
    points: z.number().int().nonnegative(),
  })
  .merge(Provenance);
export type Loyalty = z.infer<typeof Loyalty>;

export const OrderHistory = z
  .object({
    recentCategories: z.array(Category),
    recentProductIds: z.array(z.string()),
    returnsBySize: z.record(z.string(), z.number().int()).optional(),
  })
  .merge(Provenance);
export type OrderHistory = z.infer<typeof OrderHistory>;

export const Consent = z
  .object({
    personalization: z.boolean(),
    scope: z.string(),
  })
  .merge(Provenance);
export type Consent = z.infer<typeof Consent>;

export const FitRecommendation = z
  .object({
    size: z.string(),
    confidence: z.number().min(0).max(1),
  })
  .merge(Provenance);
export type FitRecommendation = z.infer<typeof FitRecommendation>;

export const RelatedProducts = z
  .object({
    productIds: z.array(z.string()),
  })
  .merge(Provenance);
export type RelatedProducts = z.infer<typeof RelatedProducts>;

/** Résultat d'une écriture déléguée au système source (réassort, panier). */
export const DelegatedWrite = z
  .object({
    accepted: z.boolean(),
    reference: z.string(),
    url: z.string().optional(),
  })
  .merge(Provenance);
export type DelegatedWrite = z.infer<typeof DelegatedWrite>;

/** Champs du contexte client que les outils peuvent demander (assemblage paresseux, L5). */
export const ContextField = z.enum(["consent", "profile", "loyalty", "history"]);
export type ContextField = z.infer<typeof ContextField>;

/** Contexte client assemblé à la demande (couche 4), jamais stocké. */
export const CustomerContext = z.object({
  tenantId: z.string(),
  customerId: z.string(), // pseudonymisé
  identity: z.object({ linked: z.array(z.string()), _src: z.string() }),
  consent: Consent.optional(),
  profile: CustomerProfile.optional(),
  loyalty: Loyalty.optional(),
  history: OrderHistory.optional(),
  _meta: z.object({
    computedAt: z.string(),
    requested: z.array(ContextField),
    missing: z.array(z.string()),
  }),
});
export type CustomerContext = z.infer<typeof CustomerContext>;
