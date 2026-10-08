/**
 * Passerelle vers les sources : cache cloisonné, budget de temps, traces et provenance.
 * C'est le seul chemin entre les briques et les connecteurs.
 */
import type { Capability, CapParams, CapResult } from "@uai/contracts";
import { runWithBudget, type RequestScope, type TenantCache } from "@uai/core";
import type { ConnectorRegistry } from "./registry.js";

/** TTL par défaut par type de donnée (secondes). 0 = jamais en cache. */
export const DEFAULT_TTL: Record<Capability, number> = {
  "catalog.search": 120,
  "catalog.get": 300,
  "inventory.online.read": 30,
  "inventory.store.read": 20,
  "stores.list": 3600,
  "customer.profile.read": 60,
  "loyalty.read": 120,
  "orders.history.read": 900,
  "consent.read": 30,
  "reco.related": 600,
  "fit.recommend": 600,
  "restock.subscribe": 0,
  "cart.prepare": 0,
};

export type GatewayResult<C extends Capability> =
  | { ok: true; value: CapResult<C>; connector: string }
  | { ok: false; reason: "missing" | "timeout" | "error"; connector?: string };

class BudgetExceeded extends Error {
  constructor(readonly outcome: "timeout" | "error") {
    super(outcome);
  }
}

const stableKey = (v: unknown): string =>
  JSON.stringify(v, (_k, val) => (val && typeof val === "object" && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort()) : val));

export class SourceGateway {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly cache: TenantCache,
  ) {}

  async call<C extends Capability>(scope: RequestScope, capability: C, params: CapParams<C>, opts: { timeoutMs?: number } = {}): Promise<GatewayResult<C>> {
    const tenant = scope.tenant;
    const connector = this.registry.forCapability(tenant.id, capability);
    if (!connector) {
      scope.addMissing(capability);
      return { ok: false, reason: "missing" };
    }
    const override = tenant.connectorOverrides[connector.id];
    const ttl = tenant.ttl[capability] ?? override?.ttlSeconds ?? DEFAULT_TTL[capability];
    const timeoutMs = Math.min(opts.timeoutMs ?? override?.timeoutMs ?? connector.budget.timeoutMs, scope.remainingMs());
    const started = performance.now();

    const load = async () => {
      const r = await runWithBudget((signal) => connector.read(capability, params, { tenantId: tenant.id, signal }), timeoutMs);
      if (!r.ok) throw new BudgetExceeded(r.outcome);
      return r.value;
    };

    try {
      // L'attente est elle-même bornée : une requête coalescée sur un chargement
      // en cours ne dépasse pas son propre budget (le chargement, lui, continue
      // et remplira le cache).
      const bounded = await runWithBudget(
        () => this.cache.forTenant(tenant.id).getOrLoad(`${connector.id}:${capability}:${stableKey(params)}`, ttl, load),
        timeoutMs + 5,
      );
      if (!bounded.ok) throw bounded.outcome === "timeout" ? new BudgetExceeded("timeout") : bounded.error;
      const { value, cache } = bounded.value;
      scope.recordTiming({ connector: connector.id, capability, ms: Math.round(performance.now() - started), outcome: "ok", cache: ttl > 0 ? cache : "none" });
      scope.recordSource(connector.id, connector.vendor, new Date().toISOString());
      return { ok: true, value: value as CapResult<C>, connector: connector.id };
    } catch (e) {
      const outcome = e instanceof BudgetExceeded ? e.outcome : "error";
      scope.recordTiming({ connector: connector.id, capability, ms: Math.round(performance.now() - started), outcome, cache: "none" });
      scope.addMissing(capability);
      return { ok: false, reason: outcome, connector: connector.id };
    }
  }
}
