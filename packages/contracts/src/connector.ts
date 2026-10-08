/**
 * Interface commune des connecteurs (couche 1).
 *
 * Un connecteur déclare ses capacités ; les briques demandent une capacité,
 * jamais un éditeur. Si aucune source ne fournit une capacité, la brique se
 * dégrade et la réponse liste ce qui manque.
 */
import type {
  Consent,
  CustomerProfile,
  DelegatedWrite,
  FitRecommendation,
  InventoryLevel,
  Loyalty,
  OrderHistory,
  Product,
  RelatedProducts,
  Store,
} from "./model.js";

export type ConnectorKind =
  | "commerce"
  | "search"
  | "loyalty"
  | "orders"
  | "inventory"
  | "fit"
  | "reco"
  | "consent"
  | "messaging";

/** Paramètres et résultat (déjà normalisé) de chaque capacité. */
export interface CapabilityMap {
  "catalog.search": {
    params: { text: string; category?: string; maxPrice?: number; limit?: number };
    result: { productIds: string[]; _src: string; _at: string };
  };
  "catalog.get": { params: { productIds: string[] }; result: Product[] };
  "inventory.online.read": { params: { skus: string[] }; result: InventoryLevel[] };
  "inventory.store.read": { params: { skus: string[]; storeIds?: string[] }; result: InventoryLevel[] };
  "stores.list": { params: Record<string, never>; result: Store[] };
  "customer.profile.read": { params: { externalId: string }; result: CustomerProfile | null };
  "loyalty.read": { params: { externalId: string }; result: Loyalty | null };
  "orders.history.read": { params: { externalId: string }; result: OrderHistory | null };
  "consent.read": { params: { externalId: string }; result: Consent | null };
  "reco.related": { params: { productId: string; limit?: number }; result: RelatedProducts };
  "fit.recommend": {
    params: { productId: string; usualSize?: string; fit?: string };
    result: FitRecommendation | null;
  };
  /** Écriture déléguée : l'abonnement vit dans le système source, pas chez nous (D1). */
  "restock.subscribe": {
    params: { externalId: string; sku: string; idempotencyKey: string };
    result: DelegatedWrite;
  };
  /** Écriture déléguée : lien de panier construit par la plateforme (D1). */
  "cart.prepare": {
    params: { items: { sku: string; qty: number }[]; idempotencyKey: string };
    result: DelegatedWrite;
  };
}

export type Capability = keyof CapabilityMap;
export type CapParams<C extends Capability> = CapabilityMap[C]["params"];
export type CapResult<C extends Capability> = CapabilityMap[C]["result"];

/** Ce que le socle transmet à un connecteur : jamais d'identifiant d'un autre client. */
export interface ConnectorCallContext {
  tenantId: string;
  /** Signal d'abandon : le budget de temps du connecteur est dépassé. */
  signal: AbortSignal;
}

export interface HealthStatus {
  ok: boolean;
  detail?: string;
}

export interface Connector {
  /** ex. "sfcc-scapi", "shopify-storefront" */
  id: string;
  kind: ConnectorKind;
  /** Plateforme ou éditeur, pour le journal et les traces. */
  vendor: string;
  /** Mode d'accès officiel à l'éditeur (API d'abord sur le chemin critique, D3). */
  access: "api" | "mcp" | "unified-api";
  capabilities(): Capability[];
  read<C extends Capability>(capability: C, params: CapParams<C>, ctx: ConnectorCallContext): Promise<CapResult<C>>;
  health(): Promise<HealthStatus>;
  freshness: { ttlSeconds: number };
  /** Budget de temps par défaut ; au-delà, coupure et réponse partielle (L1, L2). */
  budget: { timeoutMs: number };
}
