/**
 * Configuration par client (stockage n°1 du produit).
 * Versionnée : `version` est reporté dans chaque réponse (rulesVersion) et dans le journal.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { UiComponentName } from "@uai/contracts";

export const ApiKeyKind = z.enum(["public", "front", "service"]);
export type ApiKeyKind = z.infer<typeof ApiKeyKind>;

export const TenantConfig = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  platform: z.enum(["sfcc", "shopify"]),
  currency: z.string().length(3),
  version: z.string(),
  /**
   * Clés d'API : seule l'empreinte SHA-256 est stockée. Le client (tenant) est
   * déduit de la clé, jamais lu dans la requête (S3).
   * - public : partenaires et agents tiers (catalogue, stock, politiques)
   * - front  : site, app, chat ; passe au niveau "session" avec un jeton acheteur valide
   * - service: outils internes (service client), rôles obligatoires
   */
  apiKeys: z.array(
    z.object({
      sha256: z.string().length(64),
      kind: ApiKeyKind,
      label: z.string(),
      roles: z.array(z.string()).default([]),
      quotaPerMinute: z.number().int().positive().default(120),
    }),
  ),
  connectors: z.array(z.string()).min(1),
  connectorOverrides: z.record(z.string(), z.object({ timeoutMs: z.number().int().positive().optional(), ttlSeconds: z.number().int().nonnegative().optional() })).default({}),
  /** TTL de cache par capacité (secondes) ; défaut du socle sinon. */
  ttl: z.record(z.string(), z.number().int().nonnegative()).default({}),
  identity: z.object({ mode: z.enum(["map", "cdp"]) }),
  budgets: z.object({
    defaultToolMs: z.number().int().positive(),
    tools: z.record(z.string(), z.number().int().positive()).default({}),
  }),
  genUi: z.object({ components: z.array(UiComponentName) }),
  rules: z.object({
    availability: z.object({
      lowStockThreshold: z.number().int().nonnegative(),
      maxStores: z.number().int().positive(),
    }),
    look: z.object({
      complements: z.record(z.string(), z.array(z.string())),
      maxItems: z.number().int().positive(),
    }),
    ranking: z.object({
      inSizeStock: z.number(),
      recentCategory: z.number(),
      fitMatch: z.number(),
      styleMatch: z.number(),
      loyaltyExclusive: z.number(),
      loyaltyExclusiveTag: z.string().optional(),
    }),
  }),
});
export type TenantConfig = z.infer<typeof TenantConfig>;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export class TenantRegistry {
  private readonly byId = new Map<string, TenantConfig>();
  private readonly byKeyHash = new Map<string, { tenantId: string; key: TenantConfig["apiKeys"][number] }>();

  constructor(tenants: TenantConfig[]) {
    for (const t of tenants) {
      if (this.byId.has(t.id)) throw new Error(`client en double : ${t.id}`);
      this.byId.set(t.id, Object.freeze(t));
      for (const k of t.apiKeys) {
        if (this.byKeyHash.has(k.sha256)) throw new Error(`clé d'API partagée entre clients : ${k.label}`);
        this.byKeyHash.set(k.sha256, { tenantId: t.id, key: k });
      }
    }
  }

  static fromDirectory(dir: string): TenantRegistry {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    return new TenantRegistry(files.map((f) => TenantConfig.parse(JSON.parse(readFileSync(join(dir, f), "utf8")))));
  }

  get(id: string): TenantConfig | undefined {
    return this.byId.get(id);
  }

  list(): TenantConfig[] {
    return [...this.byId.values()];
  }

  /** Seul point d'entrée qui associe une requête à un client. */
  resolveKey(rawKey: string): { tenant: TenantConfig; key: TenantConfig["apiKeys"][number] } | undefined {
    const hit = this.byKeyHash.get(sha256(rawKey));
    if (!hit) return undefined;
    const tenant = this.byId.get(hit.tenantId);
    return tenant ? { tenant, key: hit.key } : undefined;
  }
}
