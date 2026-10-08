/**
 * Données simulées du second pilote (Shopify), au FORMAT NATIF Shopify
 * (Storefront et Admin GraphQL, Customer Privacy, appli de réassort).
 * Marque fictive « Maison Lune ».
 */
import { baseQuantity, hashInt } from "./stock.js";

export const SHOP_DOMAIN = "maison-lune-demo.myshopify.com";

export interface ShopifyProductNode {
  id: string; // gid://shopify/Product/…
  title: string;
  productType: string;
  tags: string[];
  priceRange: { minVariantPrice: { amount: string; currencyCode: "EUR" } };
  variants: { nodes: { id: string; selectedOptions: { name: string; value: string }[] }[] };
}

const SIZES = ["XS", "S", "M", "L"];
let next = 9000;
const prod = (title: string, productType: string, price: string, color: string, tags: string[], sizes = SIZES): ShopifyProductNode => {
  const n = ++next;
  return {
    id: `gid://shopify/Product/${n}`,
    title,
    productType,
    tags: [...tags, `couleur:${color}`],
    priceRange: { minVariantPrice: { amount: price, currencyCode: "EUR" } },
    variants: {
      nodes: sizes.map((size, i) => ({
        id: `gid://shopify/ProductVariant/${n}${String(i + 1).padStart(2, "0")}`,
        selectedOptions: [
          { name: "Taille", value: size },
          { name: "Couleur", value: color },
        ],
      })),
    },
  };
};

export const LUNE_PRODUCTS: ShopifyProductNode[] = [
  prod("Chemise en popeline écrue", "Chemise", "59.00", "écru", ["coupe:regular", "style:bureau", "style:casual"]),
  prod("T-shirt en coton biologique", "T-shirt", "29.00", "blanc", ["coupe:regular", "style:basique"]),
  prod("Pull en laine mérinos", "Pull", "89.00", "camel", ["coupe:regular", "style:hiver", "style:bureau"]),
  prod("Cardigan côtelé", "Pull", "79.00", "vert sauge", ["coupe:relaxed", "style:casual"]),
  prod("Pantalon large à pinces", "Pantalon", "95.00", "noir", ["coupe:relaxed", "style:bureau"]),
  prod("Jean droit délavé", "Pantalon", "85.00", "bleu délavé", ["coupe:regular", "style:casual"]),
  prod("Veste en velours côtelé", "Veste", "149.00", "chocolat", ["coupe:regular", "style:casual", "style:hiver"]),
  prod("Mocassins en cuir", "Chaussures", "129.00", "bordeaux", ["style:bureau"], ["37", "38", "39", "40", "41"]),
  prod("Bonnet en cachemire", "Accessoire", "45.00", "gris", ["style:hiver"], ["TU"]),
];

export const SHOPIFY_TYPE_MAP: Record<string, string> = {
  Chemise: "chemise",
  "T-shirt": "tshirt",
  Pull: "pull",
  Pantalon: "pantalon",
  Veste: "veste",
  Chaussures: "chaussures",
  Accessoire: "accessoire",
};

export const LUNE_LOCATIONS = [
  { id: "gid://shopify/Location/1", name: "Entrepôt e-shop", address: { city: "Orléans" }, fulfillsOnlineOrders: true, isStore: false },
  { id: "gid://shopify/Location/11", name: "Maison Lune Marais", address: { city: "Paris" }, fulfillsOnlineOrders: false, isStore: true },
  { id: "gid://shopify/Location/12", name: "Maison Lune Bordeaux", address: { city: "Bordeaux" }, fulfillsOnlineOrders: false, isStore: true },
  { id: "gid://shopify/Location/13", name: "Maison Lune Nantes", address: { city: "Nantes" }, fulfillsOnlineOrders: false, isStore: true },
];

export interface ShopifyInventoryLevel {
  item: { variant: { id: string } };
  location: { id: string };
  quantities: { name: "available" | "on_hand"; quantity: number }[];
  updatedAt: string;
}

export function shopifyInventoryLevel(variantGid: string, locationGid: string): ShopifyInventoryLevel {
  const online = locationGid.endsWith("/1");
  const qty = baseQuantity(variantGid, locationGid, online ? 25 : 6);
  return {
    item: { variant: { id: variantGid } },
    location: { id: locationGid },
    quantities: [
      { name: "available", quantity: qty },
      { name: "on_hand", quantity: qty + 1 },
    ],
    updatedAt: new Date(Date.now() - (hashInt(variantGid + locationGid) % 30) * 60_000).toISOString(),
  };
}

export interface ShopifyCustomer {
  id: string;
  firstName: string;
  metafields: { nodes: { namespace: string; key: string; value: string }[] };
  tags: string[];
}

export const LUNE_CUSTOMERS: ShopifyCustomer[] = [
  {
    id: "gid://shopify/Customer/7001",
    firstName: "Camille",
    metafields: {
      nodes: [
        { namespace: "uai", key: "usual_size", value: "S" },
        { namespace: "uai", key: "fit", value: "regular" },
        { namespace: "uai", key: "preferred_location", value: "gid://shopify/Location/11" },
      ],
    },
    tags: ["cliente-fidele"],
  },
  {
    id: "gid://shopify/Customer/7002",
    firstName: "Hugo",
    metafields: { nodes: [{ namespace: "uai", key: "usual_size", value: "L" }] },
    tags: [],
  },
];

export const LUNE_ORDERS: Record<string, { name: string; lineItems: { productId: string; productType: string }[] }[]> = {
  "gid://shopify/Customer/7001": [
    { name: "#1042", lineItems: [{ productId: "gid://shopify/Product/9003", productType: "Pull" }, { productId: "gid://shopify/Product/9005", productType: "Pantalon" }] },
  ],
  "gid://shopify/Customer/7002": [],
};

export const LUNE_RECOS: Record<string, string[]> = {
  "gid://shopify/Product/9001": ["gid://shopify/Product/9005", "gid://shopify/Product/9007", "gid://shopify/Product/9008"],
  "gid://shopify/Product/9003": ["gid://shopify/Product/9006", "gid://shopify/Product/9009"],
  "gid://shopify/Product/9005": ["gid://shopify/Product/9001", "gid://shopify/Product/9003"],
};

/** Customer Privacy API : "preferences" porte le consentement de personnalisation. */
export const LUNE_PRIVACY: Record<string, { analytics: boolean; marketing: boolean; preferences: boolean; sale_of_data: boolean }> = {
  "gid://shopify/Customer/7001": { analytics: true, marketing: true, preferences: true, sale_of_data: false },
  "gid://shopify/Customer/7002": { analytics: true, marketing: false, preferences: true, sale_of_data: false },
};

/** Sur Shopify, toutes les données partagent l'identifiant client : pas de table à enrichir. */
export const LUNE_IDENTITY_LINKS = LUNE_CUSTOMERS.map((c) => ({ commerce: c.id, orders: c.id, consent: c.id }));

export const LUNE_PERSONAS = [
  { externalId: "gid://shopify/Customer/7001", label: "Camille — cliente fidèle, taille S, Marais" },
  { externalId: "gid://shopify/Customer/7002", label: "Hugo — taille L, sans magasin préféré" },
];
