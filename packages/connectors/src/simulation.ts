/**
 * Simulation des systèmes sources (mode bouchon) : latence, pannes, lenteurs.
 * Pilotable depuis la démo pour montrer budgets, réponses partielles et dégradation.
 */
import { sleep } from "@uai/core";

export interface SimProfile {
  latencyMs: [number, number];
  failureRate: number;
  down: boolean;
  /** Multiplicateur de latence (ex. 4 = « Mulesoft lent »). */
  slowFactor: number;
}

export class SimulationControl {
  private readonly profiles = new Map<string, SimProfile>();
  /** Désactive toute latence (tests unitaires rapides). */
  public instant = false;
  public calls = new Map<string, number>();
  private seed = 42;

  constructor(defaults: Record<string, Partial<SimProfile>> = {}) {
    for (const [id, p] of Object.entries(defaults)) this.configure(id, p);
  }

  configure(connectorId: string, patch: Partial<SimProfile>): SimProfile {
    const current = this.profiles.get(connectorId) ?? { latencyMs: [20, 60], failureRate: 0, down: false, slowFactor: 1 };
    const next = { ...current, ...patch };
    this.profiles.set(connectorId, next);
    return next;
  }

  profile(connectorId: string): SimProfile {
    return this.profiles.get(connectorId) ?? this.configure(connectorId, {});
  }

  snapshot(): Record<string, SimProfile> {
    return Object.fromEntries(this.profiles);
  }

  reset(defaults: Record<string, Partial<SimProfile>>): void {
    this.profiles.clear();
    for (const [id, p] of Object.entries(defaults)) this.configure(id, p);
  }

  /** Pseudo-aléatoire déterministe pour des démos reproductibles. */
  private rand(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  async apply(connectorId: string, signal: AbortSignal): Promise<void> {
    this.calls.set(connectorId, (this.calls.get(connectorId) ?? 0) + 1);
    const p = this.profile(connectorId);
    if (p.down) throw new Error(`${connectorId} indisponible (simulation)`);
    if (!this.instant) {
      const [min, max] = p.latencyMs;
      await sleep((min + this.rand() * (max - min)) * p.slowFactor, signal);
    }
    if (p.failureRate > 0 && this.rand() < p.failureRate) throw new Error(`${connectorId} erreur (simulation)`);
  }
}

/** Latences par défaut des bouchons, inspirées des points d'attention du mémo. */
export const DEFAULT_SIMULATION: Record<string, Partial<SimProfile>> = {
  "sfcc-scapi": { latencyMs: [60, 140] },
  "algolia-mcp": { latencyMs: [20, 60] },
  "sfcc-oci": { latencyMs: [40, 120] },
  "sf-loyalty": { latencyMs: [80, 160] },
  "sf-oms-mulesoft": { latencyMs: [250, 650] },
  "einstein-reco": { latencyMs: [50, 120] },
  "truefit-mcp": { latencyMs: [40, 100] },
  "celio-cmp": { latencyMs: [15, 40] },
  "sfmc-restock": { latencyMs: [80, 150] },
  "shopify-storefront": { latencyMs: [40, 100] },
  "shopify-admin": { latencyMs: [60, 150] },
  "shopify-reco": { latencyMs: [40, 90] },
  "shopify-privacy": { latencyMs: [20, 50] },
  "lune-restock-app": { latencyMs: [60, 120] },
};
