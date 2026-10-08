/**
 * Contrats publics v1 (API REST, serveur MCP, chat).
 *
 * Séparés du modèle interne : le modèle peut évoluer, ces contrats ne changent
 * que par une nouvelle version (risque D2). Les entrées sont `strict` : un
 * argument inconnu (ex. `customerId` glissé par un LLM) est refusé (S1, S2).
 */
import { z } from "zod";
import { UiBlock } from "../genui.js";

export const API_VERSION = "v1" as const;

/** Niveaux d'accès (mémo, section sécurité). */
export const AccessLevel = z.enum(["public", "session", "interne"]);
export type AccessLevel = z.infer<typeof AccessLevel>;

const ProductId = z.string().min(1).max(64);
const Size = z.string().min(1).max(8);

// ---------- Entrées des outils ----------

export const SearchProductsInput = z
  .object({
    query: z.string().min(1).max(120),
    filters: z
      .object({
        category: z.string().max(32).optional(),
        maxPrice: z.number().positive().optional(),
      })
      .strict()
      .optional(),
    limit: z.number().int().min(1).max(12).optional(),
  })
  .strict();

export const CheckStoreStockInput = z
  .object({
    productId: ProductId,
    size: Size.optional(),
    city: z.string().max(64).optional(),
  })
  .strict();

export const CompleteLookInput = z.object({ productId: ProductId }).strict();
export const RecommendSizeInput = z.object({ productId: ProductId }).strict();

export const RecommendProductsInput = z
  .object({
    intent: z
      .object({
        category: z.string().max(32).optional(),
        occasion: z.string().max(64).optional(),
        budgetMax: z.number().positive().optional(),
      })
      .strict(),
    limit: z.number().int().min(1).max(8).optional(),
  })
  .strict();

export const SubscribeRestockInput = z.object({ productId: ProductId, size: Size }).strict();

export const PrepareCartInput = z
  .object({
    items: z
      .array(z.object({ productId: ProductId, size: Size, qty: z.number().int().min(1).max(5) }).strict())
      .min(1)
      .max(10),
  })
  .strict();

/** Outil Interne (service client) : la référence client vient d'un outil métier, pas d'un LLM. */
export const GetCustomerSummaryInput = z.object({ customerRef: z.string().min(1).max(64) }).strict();

// ---------- Sorties ----------

/** "unknown" : la source de stock n'a pas répondu dans son budget (jamais "out" par défaut). */
export const AvailabilityStatus = z.enum(["in_stock", "low", "out", "unknown"]);
export type AvailabilityStatus = z.infer<typeof AvailabilityStatus>;

export const ProductV1 = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  price: z.object({ amount: z.number(), currency: z.string() }),
  color: z.string(),
  sizes: z.array(z.string()),
  online: AvailabilityStatus.optional(),
});
export type ProductV1 = z.infer<typeof ProductV1>;

export const SearchProductsOutput = z.object({ products: z.array(ProductV1) });

export const StoreStockV1 = z.object({
  storeId: z.string(),
  name: z.string(),
  city: z.string(),
  status: AvailabilityStatus,
  quantity: z.number(),
  preferred: z.boolean(),
  updatedAt: z.string(),
});
export type StoreStockV1 = z.infer<typeof StoreStockV1>;

export const CheckStoreStockOutput = z.object({
  productId: z.string(),
  size: z.string().optional(),
  online: z.object({
    status: AvailabilityStatus,
    sizes: z.array(z.object({ size: z.string(), status: AvailabilityStatus })),
  }),
  stores: z.array(StoreStockV1),
  restockSuggested: z.boolean(),
});

export const LookItemV1 = z.object({
  product: ProductV1,
  inStockInSize: z.boolean().optional(),
  reasons: z.array(z.string()),
});
export const CompleteLookOutput = z.object({ productId: z.string(), size: z.string().optional(), items: z.array(LookItemV1) });

export const RecommendSizeOutput = z.object({
  productId: z.string(),
  size: z.string().optional(),
  confidence: z.number().optional(),
  source: z.enum(["fit-specialist", "profile", "none"]),
});

export const RecommendProductsOutput = z.object({
  items: z.array(z.object({ product: ProductV1, score: z.number(), reasons: z.array(z.string()) })),
});

export const SubscribeRestockOutput = z.object({ accepted: z.boolean(), reference: z.string() });
export const PrepareCartOutput = z.object({ url: z.string(), reference: z.string() });

export const GetCustomerSummaryOutput = z.object({
  customerRef: z.string(),
  firstName: z.string().optional(),
  tier: z.string().optional(),
  usualSize: z.string().optional(),
  preferredStore: z.string().optional(),
  recentCategories: z.array(z.string()),
  personalizationConsent: z.boolean(),
});

// ---------- Enveloppe commune ----------

export const Reason = z.object({ rule: z.string(), text: z.string() });
export type Reason = z.infer<typeof Reason>;

export const SourceRef = z.object({ connector: z.string(), vendor: z.string(), at: z.string() });
export type SourceRef = z.infer<typeof SourceRef>;

export const Timing = z.object({
  connector: z.string(),
  capability: z.string(),
  ms: z.number(),
  outcome: z.enum(["ok", "timeout", "error", "skipped"]),
  cache: z.enum(["hit", "miss", "stale", "coalesced", "none"]),
});
export type Timing = z.infer<typeof Timing>;

export const ToolResponseMeta = z.object({
  requestId: z.string(),
  durationMs: z.number(),
  budgetMs: z.number(),
  timings: z.array(Timing),
  level: AccessLevel,
});

export function toolResponse<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    tool: z.string(),
    version: z.literal(API_VERSION),
    data,
    reasons: z.array(Reason),
    sources: z.array(SourceRef),
    /** true si une source n'a pas répondu dans son budget : réponse partielle, jamais d'erreur bloquante. */
    partial: z.boolean(),
    /** Capacités ou champs absents, pour que le front et les agents sachent ce qui manque. */
    missing: z.array(z.string()),
    rulesVersion: z.string(),
    ui: UiBlock.nullable(),
    meta: ToolResponseMeta,
  });
}

export const AnyToolResponse = toolResponse(z.unknown());
export type ToolResponseV1<T = unknown> = Omit<z.infer<typeof AnyToolResponse>, "data"> & { data: T };

/** Erreur publique : codes stables, aucun détail interne. */
export const ApiError = z.object({
  error: z.enum([
    "unauthorized",
    "forbidden",
    "invalid_input",
    "not_found",
    "consent_required",
    "rate_limited",
    "unavailable",
  ]),
  message: z.string(),
  details: z.array(z.string()).optional(),
});
export type ApiError = z.infer<typeof ApiError>;

/** Catalogue des outils v1 : schémas d'entrée et niveau minimal d'accès. */
export const TOOL_CATALOG_V1 = {
  search_products: { level: "public", input: SearchProductsInput, output: SearchProductsOutput, description: "Rechercher des produits (prix, disponibilité en ligne)." },
  check_store_stock: { level: "public", input: CheckStoreStockInput, output: CheckStoreStockOutput, description: "Stock en ligne et en magasin d'un produit, par taille." },
  complete_look: { level: "public", input: CompleteLookInput, output: CompleteLookOutput, description: "Articles compatibles en stock pour compléter une tenue." },
  recommend_size: { level: "session", input: RecommendSizeInput, output: RecommendSizeOutput, description: "Taille recommandée pour l'acheteur connecté." },
  recommend_products: { level: "session", input: RecommendProductsInput, output: RecommendProductsOutput, description: "Liste classée avec raisons et sources." },
  subscribe_restock: { level: "session", input: SubscribeRestockInput, output: SubscribeRestockOutput, description: "Être prévenu du réassort (écriture déléguée à la source)." },
  prepare_cart: { level: "session", input: PrepareCartInput, output: PrepareCartOutput, description: "Préparer un lien de panier signé, à valider par l'acheteur." },
  get_customer_summary: { level: "interne", input: GetCustomerSummaryInput, output: GetCustomerSummaryOutput, description: "Résumé client pour un conseiller (service client)." },
} as const satisfies Record<string, { level: AccessLevel; input: z.ZodTypeAny; output: z.ZodTypeAny; description: string }>;

export type ToolName = keyof typeof TOOL_CATALOG_V1;
export const TOOL_NAMES = Object.keys(TOOL_CATALOG_V1) as ToolName[];
export type ToolInput<N extends ToolName> = z.infer<(typeof TOOL_CATALOG_V1)[N]["input"]>;
export type ToolOutput<N extends ToolName> = z.infer<(typeof TOOL_CATALOG_V1)[N]["output"]>;

const LEVEL_RANK: Record<AccessLevel, number> = { public: 0, session: 1, interne: 2 };
/** "interne" n'hérite PAS de "session" : un conseiller n'agit pas au nom d'un acheteur. */
export function levelAllows(caller: AccessLevel, required: AccessLevel): boolean {
  if (required === "interne") return caller === "interne";
  if (required === "session") return caller === "session";
  return LEVEL_RANK[caller] >= LEVEL_RANK[required];
}
