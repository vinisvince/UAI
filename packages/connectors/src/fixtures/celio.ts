/**
 * Données simulées du pilote Célio, au FORMAT NATIF des éditeurs
 * (SCAPI, OCI, Loyalty Management, OMS via Mulesoft, Einstein, True Fit, CMP).
 * Les connecteurs les normalisent vers le modèle commun.
 * Données fictives : aucune donnée réelle de Célio.
 */
import { baseQuantity, hashInt } from "./stock.js";

// ---------- SCAPI : produits ----------
export interface ScapiProduct {
  id: string;
  name: string;
  primaryCategoryId: string;
  price: number;
  currency: "EUR";
  c_color: string;
  c_fit?: "slim" | "regular" | "relaxed";
  c_styleTags: string; // séparés par "|", comme un attribut personnalisé SFCC
  variants: { productId: string; variationValues: { size: string; color: string } }[];
}

const SIZES = ["S", "M", "L", "XL"];
const v = (id: string, color: string, sizes = SIZES) =>
  sizes.map((size) => ({ productId: `${id}-${size}`, variationValues: { size, color } }));

const p = (
  id: string,
  name: string,
  cat: string,
  price: number,
  color: string,
  fit: ScapiProduct["c_fit"],
  tags: string[],
  sizes = SIZES,
): ScapiProduct => ({
  id,
  name,
  primaryCategoryId: cat,
  price,
  currency: "EUR",
  c_color: color,
  ...(fit ? { c_fit: fit } : {}),
  c_styleTags: tags.join("|"),
  variants: v(id, color, sizes),
});

export const CELIO_PRODUCTS: ScapiProduct[] = [
  p("CEL-CH-OXFORD-BLEU", "Chemise oxford bleu ciel", "men-shirts", 29.99, "bleu ciel", "slim", ["casual", "bureau"]),
  p("CEL-CH-LIN-BLANC", "Chemise en lin blanche", "men-shirts", 35.99, "blanc", "regular", ["ete", "casual"]),
  p("CEL-TS-COLROND-NOIR", "T-shirt col rond noir", "men-tshirts", 12.99, "noir", "regular", ["basique", "casual"]),
  p("CEL-PU-ROULE-MARINE", "Pull col roulé marine", "men-knitwear", 39.99, "marine", "slim", ["hiver", "bureau"]),
  p("CEL-PU-CAMIONNEUR-GRIS", "Pull camionneur gris chiné", "men-knitwear", 45.99, "gris", "regular", ["hiver", "casual"]),
  p("CEL-PA-CHINO-BEIGE", "Chino slim beige", "men-trousers", 35.99, "beige", "slim", ["casual", "bureau"]),
  p("CEL-PA-JEAN-BRUT", "Jean slim brut", "men-trousers", 39.99, "brut", "slim", ["casual"]),
  p("CEL-PA-COSTUME-GRIS", "Pantalon de costume gris", "men-trousers", 49.99, "gris", "slim", ["bureau", "ceremonie"]),
  p("CEL-VE-BLAZER-MARINE", "Blazer marine", "men-jackets", 89.99, "marine", "slim", ["bureau", "ceremonie"]),
  p("CEL-VE-SURCHEMISE-KAKI", "Surchemise kaki", "men-jackets", 49.99, "kaki", "relaxed", ["casual"]),
  p("CEL-VE-DOUDOUNE-NOIR", "Doudoune légère noire", "men-jackets", 69.99, "noir", "regular", ["hiver", "exclusif-membres"]),
  p("CEL-CHA-SNEAKERS-BLANC", "Sneakers en cuir blanches", "men-shoes", 59.99, "blanc", undefined, ["casual"], ["40", "41", "42", "43", "44", "45"]),
  p("CEL-ACC-CEINTURE-CUIR", "Ceinture en cuir marron", "men-accessories", 19.99, "marron", undefined, ["bureau", "casual"], ["90", "95", "100", "105"]),
];

export const SFCC_CATEGORY_MAP: Record<string, string> = {
  "men-shirts": "chemise",
  "men-tshirts": "tshirt",
  "men-knitwear": "pull",
  "men-trousers": "pantalon",
  "men-jackets": "veste",
  "men-shoes": "chaussures",
  "men-accessories": "accessoire",
};

// ---------- OCI : emplacements et stock ----------
export const CELIO_LOCATIONS = [
  { id: "online", name: "Entrepôt e-commerce", city: "—", type: "warehouse" as const },
  { id: "st-paris-rivoli", name: "Célio Paris Rivoli", city: "Paris", type: "store" as const },
  { id: "st-paris-defense", name: "Célio La Défense", city: "Puteaux", type: "store" as const },
  { id: "st-lyon-partdieu", name: "Célio Lyon Part-Dieu", city: "Lyon", type: "store" as const },
  { id: "st-marseille-terrasses", name: "Célio Marseille Terrasses du Port", city: "Marseille", type: "store" as const },
  { id: "st-lille-euralille", name: "Célio Lille Euralille", city: "Lille", type: "store" as const },
];

/** Cas de démonstration forcés : rupture en ligne mais stock magasin, rupture totale. */
const FORCED: Record<string, number> = {
  "CEL-CH-OXFORD-BLEU-M@online": 0,
  "CEL-CH-OXFORD-BLEU-M@st-paris-rivoli": 2,
  "CEL-CH-OXFORD-BLEU-M@st-paris-defense": 5,
  "CEL-CH-OXFORD-BLEU-M@st-lyon-partdieu": 0,
  "CEL-VE-BLAZER-MARINE-M@online": 0,
  "CEL-VE-BLAZER-MARINE-M@st-paris-rivoli": 0,
  "CEL-VE-BLAZER-MARINE-M@st-paris-defense": 0,
  "CEL-VE-BLAZER-MARINE-M@st-lyon-partdieu": 0,
  "CEL-VE-BLAZER-MARINE-M@st-marseille-terrasses": 0,
  "CEL-VE-BLAZER-MARINE-M@st-lille-euralille": 0,
  "CEL-PA-CHINO-BEIGE-M@online": 14,
  "CEL-PA-CHINO-BEIGE-M@st-paris-rivoli": 3,
  "CEL-PU-ROULE-MARINE-M@online": 9,
  "CEL-CHA-SNEAKERS-BLANC-42@online": 6,
  "CEL-VE-SURCHEMISE-KAKI-L@online": 4,
  "CEL-PA-JEAN-BRUT-L@online": 7,
};

export interface OciRecord {
  sku: string;
  locationId: string;
  onHand: number;
  ato: number; // available to order
  effectiveDate: string;
}

export function ociRecord(sku: string, locationId: string): OciRecord {
  const forced = FORCED[`${sku}@${locationId}`];
  const qty = forced ?? baseQuantity(sku, locationId, locationId === "online" ? 30 : 8);
  const minutesAgo = hashInt(sku + locationId) % 20;
  return {
    sku,
    locationId,
    onHand: qty + (qty > 0 ? 1 : 0),
    ato: qty,
    effectiveDate: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

// ---------- SCAPI Shopper Customers (via SLAS) ----------
export interface ScapiCustomer {
  customerId: string;
  firstName: string;
  c_usualSize?: string;
  c_fitPreference?: "slim" | "regular" | "relaxed";
  c_preferredStoreId?: string;
  c_segment?: string;
}

export const CELIO_CUSTOMERS: ScapiCustomer[] = [
  { customerId: "c-1001", firstName: "Thomas", c_usualSize: "M", c_fitPreference: "slim", c_preferredStoreId: "st-paris-rivoli", c_segment: "acheteur-bureau" },
  { customerId: "c-1002", firstName: "Karim", c_usualSize: "L", c_fitPreference: "regular", c_preferredStoreId: "st-lyon-partdieu", c_segment: "acheteur-saisonnier" },
  { customerId: "c-1003", firstName: "Julien", c_usualSize: "S", c_fitPreference: "slim", c_preferredStoreId: "st-lille-euralille", c_segment: "nouveau" },
];

// ---------- Salesforce Loyalty Management ----------
export const CELIO_LOYALTY = [
  { membershipNumber: "LOY-77881", memberTier: { name: "Gold" }, pointsBalance: 1840 },
  { membershipNumber: "LOY-77902", memberTier: { name: "Silver" }, pointsBalance: 420 },
];

// ---------- OMS Salesforce exposé par Mulesoft ----------
export const CELIO_OMS = [
  {
    customerRef: "MULE-CUST-5512",
    orders: [
      { orderNumber: "CEL-000981", placedAt: "2026-09-12", lines: [{ productId: "CEL-CH-OXFORD-BLEU", category: "men-shirts", size: "M", returned: false }, { productId: "CEL-PA-COSTUME-GRIS", category: "men-trousers", size: "M", returned: false }] },
      { orderNumber: "CEL-000712", placedAt: "2026-06-02", lines: [{ productId: "CEL-CH-LIN-BLANC", category: "men-shirts", size: "L", returned: true }] },
    ],
  },
  {
    customerRef: "MULE-CUST-6620",
    orders: [{ orderNumber: "CEL-000955", placedAt: "2026-09-30", lines: [{ productId: "CEL-PU-CAMIONNEUR-GRIS", category: "men-knitwear", size: "L", returned: false }] }],
  },
];

// ---------- Einstein Recommendations ----------
export const CELIO_EINSTEIN: Record<string, string[]> = {
  "CEL-CH-OXFORD-BLEU": ["CEL-PA-CHINO-BEIGE", "CEL-VE-BLAZER-MARINE", "CEL-ACC-CEINTURE-CUIR", "CEL-PA-JEAN-BRUT"],
  "CEL-CH-LIN-BLANC": ["CEL-PA-CHINO-BEIGE", "CEL-CHA-SNEAKERS-BLANC"],
  "CEL-PU-ROULE-MARINE": ["CEL-PA-COSTUME-GRIS", "CEL-VE-BLAZER-MARINE"],
  "CEL-PA-CHINO-BEIGE": ["CEL-CH-OXFORD-BLEU", "CEL-PU-ROULE-MARINE", "CEL-CHA-SNEAKERS-BLANC"],
  "CEL-VE-BLAZER-MARINE": ["CEL-CH-OXFORD-BLEU", "CEL-PA-COSTUME-GRIS"],
};

// ---------- CMP (consentements côté serveur) ----------
export const CELIO_CMP = [
  { userId: "c-1001", purposes: { personalization: { enabled: true }, analytics: { enabled: true } }, updatedAt: "2026-09-01T10:00:00Z" },
  { userId: "c-1002", purposes: { personalization: { enabled: true }, analytics: { enabled: false } }, updatedAt: "2026-08-14T10:00:00Z" },
  { userId: "c-1003", purposes: { personalization: { enabled: false }, analytics: { enabled: false } }, updatedAt: "2026-10-01T10:00:00Z" },
];

/**
 * Règles de rapprochement d'identité (exécutées au démarrage dans le bouchon) :
 * identifiant commerce → identifiants fidélité, OMS et CMP.
 */
export const CELIO_IDENTITY_LINKS: { commerce: string; loyalty?: string; orders?: string; consent?: string }[] = [
  { commerce: "c-1001", loyalty: "LOY-77881", orders: "MULE-CUST-5512", consent: "c-1001" },
  { commerce: "c-1002", loyalty: "LOY-77902", orders: "MULE-CUST-6620", consent: "c-1002" },
  { commerce: "c-1003", consent: "c-1003" },
];

export const CELIO_PERSONAS = [
  { externalId: "c-1001", label: "Thomas — membre Gold, taille M, Paris Rivoli" },
  { externalId: "c-1002", label: "Karim — membre Silver, taille L, Lyon" },
  { externalId: "c-1003", label: "Julien — a refusé la personnalisation" },
];
