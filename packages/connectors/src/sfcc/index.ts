/**
 * Connecteurs de l'écosystème Salesforce (pilote Célio), en mode bouchon.
 * Chaque connecteur lit le format natif de l'éditeur et le normalise.
 */
import {
  Consent,
  CustomerProfile,
  DelegatedWrite,
  FitRecommendation,
  InventoryLevel,
  Loyalty,
  OrderHistory,
  Product,
  Store,
  type Category,
} from "@uai/contracts";
import { MockConnector, nowIso, type Handlers } from "../base.js";
import {
  CELIO_CMP,
  CELIO_CUSTOMERS,
  CELIO_EINSTEIN,
  CELIO_LOCATIONS,
  CELIO_LOYALTY,
  CELIO_OMS,
  CELIO_PRODUCTS,
  SFCC_CATEGORY_MAP,
  ociRecord,
  type OciRecord,
  type ScapiCustomer,
  type ScapiProduct,
} from "../fixtures/celio.js";
import { hashInt } from "../fixtures/stock.js";
import { searchCatalog } from "../search.js";

// ---------- Normaliseurs (testés par contrat) ----------

export function normalizeScapiProduct(raw: ScapiProduct, at: string): Product {
  return Product.parse({
    id: raw.id,
    title: raw.name,
    category: SFCC_CATEGORY_MAP[raw.primaryCategoryId] as Category,
    price: { amount: raw.price, currency: raw.currency },
    color: raw.c_color,
    ...(raw.c_fit ? { fit: raw.c_fit } : {}),
    styleTags: raw.c_styleTags.split("|").filter(Boolean),
    variants: raw.variants.map((v) => ({ sku: v.productId, size: v.variationValues.size, color: v.variationValues.color })),
    _src: "sfcc-scapi",
    _at: at,
  });
}

export function normalizeOciRecord(raw: OciRecord): InventoryLevel {
  return InventoryLevel.parse({
    sku: raw.sku,
    locationId: raw.locationId,
    quantity: Math.max(0, raw.ato),
    updatedAt: raw.effectiveDate,
    _src: "sfcc-oci",
    _at: nowIso(),
  });
}

export function normalizeScapiCustomer(raw: ScapiCustomer, at: string): CustomerProfile {
  return CustomerProfile.parse({
    usualSize: raw.c_usualSize,
    fit: raw.c_fitPreference,
    segment: raw.c_segment,
    preferredStoreId: raw.c_preferredStoreId,
    firstName: raw.firstName,
    _src: "sfcc-scapi",
    _at: at,
  });
}

const TIERS: Record<string, Loyalty["tier"]> = { Gold: "gold", Silver: "silver", Member: "member" };

const catalog = () => CELIO_PRODUCTS.map((p) => normalizeScapiProduct(p, nowIso()));

// ---------- SCAPI (commerce) ----------

export class ScapiConnector extends MockConnector {
  readonly id = "sfcc-scapi";
  readonly kind = "commerce" as const;
  readonly vendor = "Salesforce Commerce Cloud (SCAPI)";
  readonly access = "api" as const;
  readonly freshness = { ttlSeconds: 300 };
  readonly budget = { timeoutMs: 250 };
  private readonly baskets = new Map<string, string>();

  protected readonly handlers: Handlers = {
    "catalog.search": ({ text, category, maxPrice, limit }) => ({
      productIds: searchCatalog(catalog(), text, { category, maxPrice, limit }),
      _src: this.id,
      _at: nowIso(),
    }),
    "catalog.get": ({ productIds }) =>
      CELIO_PRODUCTS.filter((p) => productIds.includes(p.id)).map((p) => normalizeScapiProduct(p, nowIso())),
    "customer.profile.read": ({ externalId }) => {
      const c = CELIO_CUSTOMERS.find((x) => x.customerId === externalId);
      return c ? normalizeScapiCustomer(c, nowIso()) : null;
    },
    /** Écriture déléguée : le panier est créé par SCAPI ; on ne stocke rien (D1). */
    "cart.prepare": ({ items, idempotencyKey }) => {
      let basketId = this.baskets.get(idempotencyKey);
      if (!basketId) {
        basketId = `bsk-${hashInt(idempotencyKey).toString(16)}`;
        this.baskets.set(idempotencyKey, basketId);
      }
      const lines = items.map((i) => `${i.sku}:${i.qty}`).join(",");
      return DelegatedWrite.parse({
        accepted: true,
        reference: basketId,
        url: `https://pilote-celio.example/panier?basket=${basketId}&lines=${encodeURIComponent(lines)}`,
        _src: this.id,
        _at: nowIso(),
      });
    },
  };
}

// ---------- Algolia (recherche, via son serveur MCP) ----------

export class AlgoliaConnector extends MockConnector {
  readonly id = "algolia-mcp";
  readonly kind = "search" as const;
  readonly vendor = "Algolia";
  readonly access = "mcp" as const;
  readonly freshness = { ttlSeconds: 120 };
  readonly budget = { timeoutMs: 150 };
  protected readonly handlers: Handlers = {
    "catalog.search": ({ text, category, maxPrice, limit }) => ({
      productIds: searchCatalog(catalog(), text, { category, maxPrice, limit }),
      _src: this.id,
      _at: nowIso(),
    }),
  };
}

// ---------- Omnichannel Inventory (stock) ----------

export class OciConnector extends MockConnector {
  readonly id = "sfcc-oci";
  readonly kind = "inventory" as const;
  readonly vendor = "Salesforce Omnichannel Inventory";
  readonly access = "api" as const;
  readonly freshness = { ttlSeconds: 20 };
  readonly budget = { timeoutMs: 200 };
  protected readonly handlers: Handlers = {
    /** Lecture groupée multi-SKU : un seul appel pour toute une liste (L1). */
    "inventory.online.read": ({ skus }) => skus.map((s) => normalizeOciRecord(ociRecord(s, "online"))),
    "inventory.store.read": ({ skus, storeIds }) => {
      const stores = CELIO_LOCATIONS.filter((l) => l.type === "store" && (!storeIds || storeIds.includes(l.id)));
      return skus.flatMap((s) => stores.map((l) => normalizeOciRecord(ociRecord(s, l.id))));
    },
    "stores.list": () =>
      CELIO_LOCATIONS.filter((l) => l.type === "store").map((l) =>
        Store.parse({ id: l.id, name: l.name, city: l.city, _src: this.id, _at: nowIso() }),
      ),
  };
}

// ---------- Loyalty Management ----------

export class LoyaltyConnector extends MockConnector {
  readonly id = "sf-loyalty";
  readonly kind = "loyalty" as const;
  readonly vendor = "Salesforce Loyalty Management";
  readonly access = "api" as const;
  readonly freshness = { ttlSeconds: 120 };
  readonly budget = { timeoutMs: 250 };
  protected readonly handlers: Handlers = {
    "loyalty.read": ({ externalId }) => {
      const m = CELIO_LOYALTY.find((x) => x.membershipNumber === externalId);
      return m
        ? Loyalty.parse({ tier: TIERS[m.memberTier.name] ?? "member", points: m.pointsBalance, _src: this.id, _at: nowIso() })
        : null;
    },
  };
}

// ---------- OMS via Mulesoft (lent : hors chemin critique, préchargé) ----------

export class OmsMulesoftConnector extends MockConnector {
  readonly id = "sf-oms-mulesoft";
  readonly kind = "orders" as const;
  readonly vendor = "Salesforce OMS via Mulesoft";
  readonly access = "api" as const;
  readonly freshness = { ttlSeconds: 900 };
  readonly budget = { timeoutMs: 350 };
  protected readonly handlers: Handlers = {
    "orders.history.read": ({ externalId }) => {
      const c = CELIO_OMS.find((x) => x.customerRef === externalId);
      if (!c) return null;
      const lines = c.orders.flatMap((o) => o.lines);
      const returnsBySize: Record<string, number> = {};
      for (const l of lines) if (l.returned) returnsBySize[l.size] = (returnsBySize[l.size] ?? 0) + 1;
      return OrderHistory.parse({
        recentCategories: [...new Set(lines.map((l) => SFCC_CATEGORY_MAP[l.category]))],
        recentProductIds: [...new Set(lines.map((l) => l.productId))],
        returnsBySize,
        _src: this.id,
        _at: nowIso(),
      });
    },
  };
}

// ---------- Einstein (recommandations) ----------

export class EinsteinConnector extends MockConnector {
  readonly id = "einstein-reco";
  readonly kind = "reco" as const;
  readonly vendor = "Salesforce Einstein";
  readonly access = "api" as const;
  readonly freshness = { ttlSeconds: 600 };
  readonly budget = { timeoutMs: 200 };
  protected readonly handlers: Handlers = {
    "reco.related": ({ productId, limit }) => ({
      productIds: (CELIO_EINSTEIN[productId] ?? []).slice(0, limit ?? 6),
      _src: this.id,
      _at: nowIso(),
    }),
  };
}

// ---------- True Fit (taille, via son serveur MCP) ----------

const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL"];

export class TrueFitConnector extends MockConnector {
  readonly id = "truefit-mcp";
  readonly kind = "fit" as const;
  readonly vendor = "True Fit";
  readonly access = "mcp" as const;
  readonly freshness = { ttlSeconds: 600 };
  readonly budget = { timeoutMs: 200 };
  protected readonly handlers: Handlers = {
    "fit.recommend": ({ productId, usualSize, fit }) => {
      const product = CELIO_PRODUCTS.find((p) => p.id === productId);
      if (!product || !usualSize) return null;
      const sizes = product.variants.map((v) => v.variationValues.size);
      let idx = SIZE_ORDER.indexOf(usualSize);
      if (idx < 0 || !sizes.includes(usualSize)) return null;
      let confidence = 0.86;
      // Coupe slim pour quelqu'un qui préfère regular : une taille au-dessus.
      if (product.c_fit === "slim" && fit === "regular" && SIZE_ORDER[idx + 1] && sizes.includes(SIZE_ORDER[idx + 1]!)) {
        idx += 1;
        confidence = 0.74;
      }
      return FitRecommendation.parse({ size: SIZE_ORDER[idx], confidence, _src: this.id, _at: nowIso() });
    },
  };
}

// ---------- CMP (consentements côté serveur, S7) ----------

export class CelioCmpConnector extends MockConnector {
  readonly id = "celio-cmp";
  readonly kind = "consent" as const;
  readonly vendor = "CMP Célio (API serveur)";
  readonly access = "api" as const;
  readonly freshness = { ttlSeconds: 30 };
  readonly budget = { timeoutMs: 120 };
  protected readonly handlers: Handlers = {
    "consent.read": ({ externalId }) => {
      const r = CELIO_CMP.find((x) => x.userId === externalId);
      return r
        ? Consent.parse({ personalization: r.purposes.personalization.enabled, scope: "celio-site-app", _src: this.id, _at: r.updatedAt })
        : null;
    },
  };
}

// ---------- Marketing Cloud (abonnement au réassort, écriture déléguée) ----------

export class SfmcRestockConnector extends MockConnector {
  readonly id = "sfmc-restock";
  readonly kind = "messaging" as const;
  readonly vendor = "Salesforce Marketing Cloud";
  readonly access = "api" as const;
  readonly freshness = { ttlSeconds: 0 };
  readonly budget = { timeoutMs: 300 };
  /** L'abonnement vit dans le système source (ici, la mémoire du bouchon). */
  readonly subscriptions = new Map<string, { sku: string; externalId: string }>();
  protected readonly handlers: Handlers = {
    "restock.subscribe": ({ externalId, sku, idempotencyKey }) => {
      if (!this.subscriptions.has(idempotencyKey)) this.subscriptions.set(idempotencyKey, { sku, externalId });
      return DelegatedWrite.parse({ accepted: true, reference: `sfmc-${hashInt(idempotencyKey).toString(16)}`, _src: this.id, _at: nowIso() });
    },
  };
}
