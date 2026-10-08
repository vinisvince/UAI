/**
 * Connecteurs Shopify (second pilote, marque fictive « Maison Lune »), en mode bouchon.
 * Même interface que les connecteurs Salesforce : seules la normalisation et la
 * configuration changent (preuve de portabilité).
 */
import {
  Consent,
  CustomerProfile,
  DelegatedWrite,
  InventoryLevel,
  OrderHistory,
  Product,
  Store,
  type Category,
} from "@uai/contracts";
import { MockConnector, nowIso, type Handlers } from "../base.js";
import {
  LUNE_CUSTOMERS,
  LUNE_LOCATIONS,
  LUNE_ORDERS,
  LUNE_PRIVACY,
  LUNE_PRODUCTS,
  LUNE_RECOS,
  SHOPIFY_TYPE_MAP,
  SHOP_DOMAIN,
  shopifyInventoryLevel,
  type ShopifyCustomer,
  type ShopifyInventoryLevel,
  type ShopifyProductNode,
} from "../fixtures/lune.js";
import { hashInt } from "../fixtures/stock.js";
import { searchCatalog } from "../search.js";

// ---------- Correspondance des identifiants Shopify (gid) ↔ modèle commun ----------

const tail = (gid: string) => gid.split("/").pop() ?? gid;
export const shopifyIds = {
  product: (gid: string) => `shp-${tail(gid)}`,
  productGid: (id: string) => `gid://shopify/Product/${id.replace(/^shp-/, "")}`,
  variant: (gid: string) => `shpv-${tail(gid)}`,
  variantGid: (sku: string) => `gid://shopify/ProductVariant/${sku.replace(/^shpv-/, "")}`,
  location: (gid: string) => `loc-${tail(gid)}`,
  locationGid: (id: string) => `gid://shopify/Location/${id.replace(/^loc-/, "")}`,
};

const opt = (node: ShopifyProductNode["variants"]["nodes"][number], name: string) =>
  node.selectedOptions.find((o) => o.name === name)?.value ?? "";

// ---------- Normaliseurs ----------

export function normalizeShopifyProduct(raw: ShopifyProductNode, at: string): Product {
  const fitTag = raw.tags.find((t) => t.startsWith("coupe:"))?.slice(6);
  return Product.parse({
    id: shopifyIds.product(raw.id),
    title: raw.title,
    category: SHOPIFY_TYPE_MAP[raw.productType] as Category,
    price: { amount: Number(raw.priceRange.minVariantPrice.amount), currency: raw.priceRange.minVariantPrice.currencyCode },
    color: raw.tags.find((t) => t.startsWith("couleur:"))?.slice(8) ?? "",
    ...(fitTag ? { fit: fitTag } : {}),
    styleTags: raw.tags.filter((t) => t.startsWith("style:")).map((t) => t.slice(6)),
    variants: raw.variants.nodes.map((n) => ({ sku: shopifyIds.variant(n.id), size: opt(n, "Taille"), color: opt(n, "Couleur") })),
    _src: "shopify-storefront",
    _at: at,
  });
}

export function normalizeShopifyInventory(raw: ShopifyInventoryLevel): InventoryLevel {
  const online = LUNE_LOCATIONS.find((l) => l.id === raw.location.id)?.fulfillsOnlineOrders;
  return InventoryLevel.parse({
    sku: shopifyIds.variant(raw.item.variant.id),
    locationId: online ? "online" : shopifyIds.location(raw.location.id),
    quantity: Math.max(0, raw.quantities.find((q) => q.name === "available")?.quantity ?? 0),
    updatedAt: raw.updatedAt,
    _src: "shopify-admin",
    _at: nowIso(),
  });
}

export function normalizeShopifyCustomer(raw: ShopifyCustomer, at: string): CustomerProfile {
  const mf = (key: string) => raw.metafields.nodes.find((m) => m.namespace === "uai" && m.key === key)?.value;
  const loc = mf("preferred_location");
  return CustomerProfile.parse({
    usualSize: mf("usual_size"),
    fit: mf("fit"),
    segment: raw.tags[0],
    preferredStoreId: loc ? shopifyIds.location(loc) : undefined,
    firstName: raw.firstName,
    _src: "shopify-admin",
    _at: at,
  });
}

const catalog = () => LUNE_PRODUCTS.map((p) => normalizeShopifyProduct(p, nowIso()));
const ONLINE_LOCATION = LUNE_LOCATIONS.find((l) => l.fulfillsOnlineOrders)!;

// ---------- Storefront API ----------

export class ShopifyStorefrontConnector extends MockConnector {
  readonly id = "shopify-storefront";
  readonly kind = "commerce" as const;
  readonly vendor = "Shopify Storefront API";
  readonly access = "api" as const;
  readonly freshness = { ttlSeconds: 300 };
  readonly budget = { timeoutMs: 200 };
  protected readonly handlers: Handlers = {
    "catalog.search": ({ text, category, maxPrice, limit }) => ({
      productIds: searchCatalog(catalog(), text, { category, maxPrice, limit }),
      _src: this.id,
      _at: nowIso(),
    }),
    "catalog.get": ({ productIds }) => {
      const gids = new Set(productIds.map(shopifyIds.productGid));
      return LUNE_PRODUCTS.filter((p) => gids.has(p.id)).map((p) => normalizeShopifyProduct(p, nowIso()));
    },
    /** Lien de panier Shopify (cart permalink) : le panier reste chez la plateforme (D1). */
    "cart.prepare": ({ items, idempotencyKey }) =>
      DelegatedWrite.parse({
        accepted: true,
        reference: `cart-${hashInt(idempotencyKey).toString(16)}`,
        url: `https://${SHOP_DOMAIN}/cart/${items.map((i) => `${shopifyIds.variantGid(i.sku).split("/").pop()}:${i.qty}`).join(",")}`,
        _src: this.id,
        _at: nowIso(),
      }),
  };
}

// ---------- Admin API (stock par emplacement, clients, commandes) ----------

export class ShopifyAdminConnector extends MockConnector {
  readonly id = "shopify-admin";
  readonly kind = "inventory" as const;
  readonly vendor = "Shopify Admin API";
  readonly access = "api" as const;
  readonly freshness = { ttlSeconds: 30 };
  readonly budget = { timeoutMs: 250 };
  protected readonly handlers: Handlers = {
    "inventory.online.read": ({ skus }) =>
      skus.map((s) => normalizeShopifyInventory(shopifyInventoryLevel(shopifyIds.variantGid(s), ONLINE_LOCATION.id))),
    "inventory.store.read": ({ skus, storeIds }) => {
      const stores = LUNE_LOCATIONS.filter((l) => l.isStore && (!storeIds || storeIds.includes(shopifyIds.location(l.id))));
      return skus.flatMap((s) => stores.map((l) => normalizeShopifyInventory(shopifyInventoryLevel(shopifyIds.variantGid(s), l.id))));
    },
    "stores.list": () =>
      LUNE_LOCATIONS.filter((l) => l.isStore).map((l) =>
        Store.parse({ id: shopifyIds.location(l.id), name: l.name, city: l.address.city, _src: this.id, _at: nowIso() }),
      ),
    "customer.profile.read": ({ externalId }) => {
      const c = LUNE_CUSTOMERS.find((x) => x.id === externalId);
      return c ? normalizeShopifyCustomer(c, nowIso()) : null;
    },
    "orders.history.read": ({ externalId }) => {
      const orders = LUNE_ORDERS[externalId];
      if (!orders) return null;
      const lines = orders.flatMap((o) => o.lineItems);
      return OrderHistory.parse({
        recentCategories: [...new Set(lines.map((l) => SHOPIFY_TYPE_MAP[l.productType]))],
        recentProductIds: [...new Set(lines.map((l) => shopifyIds.product(l.productId)))],
        _src: this.id,
        _at: nowIso(),
      });
    },
  };
}

// ---------- Recommandations Shopify ----------

export class ShopifyRecoConnector extends MockConnector {
  readonly id = "shopify-reco";
  readonly kind = "reco" as const;
  readonly vendor = "Shopify Product Recommendations";
  readonly access = "api" as const;
  readonly freshness = { ttlSeconds: 600 };
  readonly budget = { timeoutMs: 200 };
  protected readonly handlers: Handlers = {
    "reco.related": ({ productId, limit }) => ({
      productIds: (LUNE_RECOS[shopifyIds.productGid(productId)] ?? []).map(shopifyIds.product).slice(0, limit ?? 6),
      _src: this.id,
      _at: nowIso(),
    }),
  };
}

// ---------- Customer Privacy (consentement) ----------

export class ShopifyPrivacyConnector extends MockConnector {
  readonly id = "shopify-privacy";
  readonly kind = "consent" as const;
  readonly vendor = "Shopify Customer Privacy";
  readonly access = "api" as const;
  readonly freshness = { ttlSeconds: 30 };
  readonly budget = { timeoutMs: 120 };
  protected readonly handlers: Handlers = {
    "consent.read": ({ externalId }) => {
      const r = LUNE_PRIVACY[externalId];
      return r ? Consent.parse({ personalization: r.preferences, scope: "maison-lune-shop", _src: this.id, _at: nowIso() }) : null;
    },
  };
}

// ---------- Appli de réassort Shopify (écriture déléguée) ----------

export class LuneRestockAppConnector extends MockConnector {
  readonly id = "lune-restock-app";
  readonly kind = "messaging" as const;
  readonly vendor = "Appli « Back in stock » Shopify";
  readonly access = "api" as const;
  readonly freshness = { ttlSeconds: 0 };
  readonly budget = { timeoutMs: 300 };
  readonly subscriptions = new Map<string, { sku: string; externalId: string }>();
  protected readonly handlers: Handlers = {
    "restock.subscribe": ({ externalId, sku, idempotencyKey }) => {
      if (!this.subscriptions.has(idempotencyKey)) this.subscriptions.set(idempotencyKey, { sku, externalId });
      return DelegatedWrite.parse({ accepted: true, reference: `bis-${hashInt(idempotencyKey).toString(16)}`, _src: this.id, _at: nowIso() });
    },
  };
}
