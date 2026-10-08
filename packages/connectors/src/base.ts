import type { Capability, CapParams, CapResult, Connector, ConnectorCallContext, ConnectorKind, HealthStatus } from "@uai/contracts";
import type { SimulationControl } from "./simulation.js";

export type Handlers = { [C in Capability]?: (params: CapParams<C>, ctx: ConnectorCallContext) => Promise<CapResult<C>> | CapResult<C> };

/** Base des bouchons : chaque appel passe par la simulation (latence, panne). */
export abstract class MockConnector implements Connector {
  abstract readonly id: string;
  abstract readonly kind: ConnectorKind;
  abstract readonly vendor: string;
  abstract readonly access: "api" | "mcp" | "unified-api";
  abstract readonly freshness: { ttlSeconds: number };
  abstract readonly budget: { timeoutMs: number };
  protected abstract readonly handlers: Handlers;

  constructor(protected readonly sim: SimulationControl) {}

  capabilities(): Capability[] {
    return Object.keys(this.handlers) as Capability[];
  }

  async read<C extends Capability>(capability: C, params: CapParams<C>, ctx: ConnectorCallContext): Promise<CapResult<C>> {
    const handler = this.handlers[capability] as ((p: CapParams<C>, c: ConnectorCallContext) => Promise<CapResult<C>> | CapResult<C>) | undefined;
    if (!handler) throw new Error(`${this.id} ne fournit pas ${capability}`);
    await this.sim.apply(this.id, ctx.signal);
    return handler(params, ctx);
  }

  async health(): Promise<HealthStatus> {
    const p = this.sim.profile(this.id);
    return p.down ? { ok: false, detail: "indisponible (simulation)" } : { ok: true };
  }
}

export const nowIso = () => new Date().toISOString();
