/**
 * Catalogue d'outils (contrat 2) et exécuteur commun à REST, MCP et chat.
 *
 * Pour chaque appel : niveau d'accès, quota, validation stricte des entrées,
 * budget de temps, contexte client minimal, réponse justifiée, journal.
 */
import {
  API_VERSION,
  TOOL_CATALOG_V1,
  levelAllows,
  validateUiBlock,
  type ContextField,
  type CustomerContext,
  type ToolName,
  type ToolResponseV1,
  type UiBlock,
} from "@uai/contracts";
import { RequestScope, UaiError, type Caller, type IdentityMap, type Journal, type RateLimiter, type SecretVault } from "@uai/core";
import type { SourceGateway } from "@uai/connectors";
import { getCustomerSummary, prepareCart, subscribeRestock } from "./bricks/actions.js";
import { checkStoreStock } from "./bricks/availability.js";
import { recommendSize } from "./bricks/fit.js";
import { completeLook } from "./bricks/look.js";
import { recommendProducts, searchProducts } from "./bricks/search.js";
import { ContextAssembler } from "./context.js";

export interface EngineDeps {
  gateway: SourceGateway;
  identity: IdentityMap;
  vault: SecretVault;
  journal: Journal;
  rateLimiter: RateLimiter;
}

interface ToolRun {
  data: unknown;
  ui?: UiBlock | null;
  customerRef?: string;
}

interface ToolDef {
  /** Champs du contexte client lus si un acheteur est connecté (L5). */
  contextFields: ContextField[];
  run(input: never, scope: RequestScope, ctx: CustomerContext | undefined, deps: EngineDeps): Promise<ToolRun>;
}

const def = <N extends ToolName>(
  _name: N,
  contextFields: ContextField[],
  run: (input: import("@uai/contracts").ToolInput<N>, scope: RequestScope, ctx: CustomerContext | undefined, deps: EngineDeps) => Promise<ToolRun>,
): ToolDef => ({ contextFields, run: run as ToolDef["run"] });

export const TOOL_DEFS: Record<ToolName, ToolDef> = {
  search_products: def("search_products", [], (i, s, _c, d) => searchProducts(d.gateway, s, i)),
  check_store_stock: def("check_store_stock", ["profile"], (i, s, c, d) => checkStoreStock(d.gateway, s, i, c)),
  complete_look: def("complete_look", ["profile", "loyalty", "history"], (i, s, c, d) => completeLook(d.gateway, s, i, c)),
  recommend_size: def("recommend_size", ["profile", "history"], (i, s, c, d) => recommendSize(d.gateway, s, i, c)),
  recommend_products: def("recommend_products", ["profile", "loyalty", "history"], (i, s, c, d) => recommendProducts(d.gateway, s, i, c)),
  subscribe_restock: def("subscribe_restock", [], (i, s, _c, d) => subscribeRestock(d.gateway, s, i)),
  prepare_cart: def("prepare_cart", [], (i, s, _c, d) => prepareCart(d.gateway, s, d.vault, i)),
  get_customer_summary: def("get_customer_summary", [], (i, s, _c, d) => getCustomerSummary(d.gateway, s, d.identity, i)),
};

export function toolsForLevel(level: Caller["level"]): ToolName[] {
  return (Object.keys(TOOL_CATALOG_V1) as ToolName[]).filter((n) => levelAllows(level, TOOL_CATALOG_V1[n].level));
}

export class ToolExecutor {
  private readonly assembler: ContextAssembler;

  constructor(private readonly deps: EngineDeps) {
    this.assembler = new ContextAssembler(deps.gateway);
  }

  async execute(name: string, rawInput: unknown, caller: Caller, channel: "rest" | "mcp" | "chat" = "rest"): Promise<ToolResponseV1> {
    const tenant = caller.tenant;
    const started = performance.now();
    const journalBase = {
      tenantId: tenant.id,
      caller: { level: caller.level, keyLabel: caller.keyLabel, ...(caller.role ? { role: caller.role, motif: caller.motif } : {}) },
      channel,
      tool: name,
      rulesVersion: tenant.version,
    };
    const deny = (err: UaiError, requestId = "-"): never => {
      this.deps.journal.append({
        ...journalBase,
        requestId,
        consent: "unknown",
        connectorsRead: [],
        partial: false,
        outcome: "denied",
        durationMs: Math.round(performance.now() - started),
        ...(caller.customer ? { customerRef: caller.customer.pseudoId } : {}),
      });
      throw err;
    };

    if (!(name in TOOL_CATALOG_V1)) deny(new UaiError("not_found", `Outil inconnu : ${name}`));
    const toolName = name as ToolName;
    const spec = TOOL_CATALOG_V1[toolName];

    if (!levelAllows(caller.level, spec.level)) {
      deny(new UaiError("forbidden", `L'outil ${toolName} exige le niveau ${spec.level} (appelant : ${caller.level}).`));
    }
    const key = tenant.apiKeys.find((k) => k.label === caller.keyLabel);
    if (!this.deps.rateLimiter.take(tenant.id, caller.keyLabel, key?.quotaPerMinute ?? 60).ok) {
      deny(new UaiError("rate_limited", "Quota de requêtes dépassé pour cette clé."));
    }
    const parsed = spec.input.safeParse(rawInput ?? {});
    if (!parsed.success) {
      deny(new UaiError("invalid_input", "Entrée invalide.", parsed.error.issues.map((i) => `${i.path.join(".") || "(racine)"}: ${i.message}`)));
    }

    const tool = TOOL_DEFS[toolName];
    const scope = new RequestScope(caller, tenant.budgets.tools[toolName] ?? tenant.budgets.defaultToolMs, channel);
    try {
      // Le produit est lu pendant l'assemblage du contexte : la brique le retrouvera
      // en cache (requête coalescée) au lieu d'attendre en série (L1).
      const productId = (parsed.data as { productId?: unknown }).productId;
      if (typeof productId === "string" && tool.contextFields.length && caller.customer) {
        void this.deps.gateway.call(scope, "catalog.get", { productIds: [productId] });
      }
      const ctx = tool.contextFields.length ? await this.assembler.assemble(scope, tool.contextFields) : undefined;
      const run = await tool.run(parsed.data as never, scope, ctx, this.deps);
      const data = spec.output.parse(run.data);

      let ui: UiBlock | null = run.ui ?? null;
      if (ui) {
        const check = validateUiBlock(ui, tenant.genUi.components, uiIdsFrom([{ data, ui: null }]));
        if (!check.ok) ui = null;
      }

      const response: ToolResponseV1 = {
        tool: toolName,
        version: API_VERSION,
        data,
        reasons: scope.reasons,
        sources: scope.sourceList(),
        partial: scope.partial,
        missing: [...scope.missing],
        rulesVersion: tenant.version,
        ui,
        meta: { requestId: scope.requestId, durationMs: scope.elapsedMs(), budgetMs: scope.budgetMs, timings: scope.timings, level: caller.level },
      };
      this.deps.journal.append({
        ...journalBase,
        requestId: scope.requestId,
        consent: scope.consent,
        connectorsRead: scope.connectorsRead(),
        partial: scope.partial,
        outcome: "ok",
        durationMs: response.meta.durationMs,
        ...(run.customerRef ?? caller.customer ? { customerRef: run.customerRef ?? caller.customer?.pseudoId } : {}),
      });
      return response;
    } catch (e) {
      const err = e instanceof UaiError ? e : new UaiError("unavailable", "Service temporairement indisponible.");
      this.deps.journal.append({
        ...journalBase,
        requestId: scope.requestId,
        consent: scope.consent,
        connectorsRead: scope.connectorsRead(),
        partial: scope.partial,
        outcome: "error",
        durationMs: scope.elapsedMs(),
        ...(caller.customer ? { customerRef: caller.customer.pseudoId } : {}),
      });
      throw err;
    }
  }

  /** Préchargement à la connexion : sources lentes hors du chemin critique (L2, D5). */
  async prefetch(caller: Caller): Promise<void> {
    if (!caller.customer) return;
    // Hors chemin critique : budget large, le résultat remplit le cache (TTL long pour l'historique).
    const scope = new RequestScope(caller, 3_000, "rest");
    await this.assembler.assemble(scope, ["profile", "loyalty", "history"], { timeoutMs: 2_000 });
  }
}

/**
 * Identifiants qu'un bloc Gen UI peut référencer : ceux présents dans les
 * réponses d'outils du tour (validation sémantique, S5).
 */
export function uiIdsFrom(responses: { data: unknown; ui: UiBlock | null }[]) {
  const productIds = new Set<string>();
  const storeIds = new Set<string>();
  const sizes = new Map<string, Set<string>>();
  const addSizes = (id: string, list: string[]) => {
    const s = sizes.get(id) ?? new Set<string>();
    list.forEach((x) => s.add(x));
    sizes.set(id, s);
  };
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (typeof o.id === "string" && Array.isArray(o.sizes)) {
      productIds.add(o.id);
      addSizes(o.id, o.sizes as string[]);
    }
    if (typeof o.productId === "string") {
      productIds.add(o.productId);
      if (typeof o.size === "string") addSizes(o.productId, [o.size]);
      if (o.online && typeof o.online === "object" && Array.isArray((o.online as { sizes?: unknown }).sizes)) {
        addSizes(o.productId, ((o.online as { sizes: { size: string }[] }).sizes).map((x) => x.size));
      }
    }
    if (typeof o.storeId === "string") storeIds.add(o.storeId);
    Object.values(o).forEach(visit);
  };
  responses.forEach((r) => visit(r.data));
  return { productIds, storeIds, sizes };
}
