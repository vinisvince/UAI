/**
 * Contexte d'une requête : client, appelant, budget, traces et provenance.
 * Les attributs de trace sont en liste blanche : aucune donnée personnelle (S10).
 */
import { randomUUID } from "node:crypto";
import type { Reason, SourceRef, Timing } from "@uai/contracts";
import type { Caller } from "./auth.js";

export class RequestScope {
  readonly requestId = randomUUID();
  readonly startedAt = performance.now();
  readonly deadlineAt: number;
  readonly timings: Timing[] = [];
  readonly reasons: Reason[] = [];
  readonly missing = new Set<string>();
  private readonly sources = new Map<string, SourceRef>();
  partial = false;
  consent: "granted" | "refused" | "not_required" | "unknown" = "not_required";

  constructor(
    readonly caller: Caller,
    readonly budgetMs: number,
    readonly channel: "rest" | "mcp" | "chat" = "rest",
  ) {
    this.deadlineAt = this.startedAt + budgetMs;
  }

  get tenant() {
    return this.caller.tenant;
  }

  remainingMs(): number {
    return Math.max(0, Math.floor(this.deadlineAt - performance.now()));
  }

  elapsedMs(): number {
    return Math.round(performance.now() - this.startedAt);
  }

  recordTiming(t: Timing): void {
    this.timings.push(t);
    if (t.outcome === "timeout" || t.outcome === "error") this.partial = true;
  }

  recordSource(connector: string, vendor: string, at: string): void {
    const prev = this.sources.get(connector);
    if (!prev || prev.at < at) this.sources.set(connector, { connector, vendor, at });
  }

  addReason(rule: string, text: string): void {
    if (!this.reasons.some((r) => r.rule === rule && r.text === text)) this.reasons.push({ rule, text });
  }

  addMissing(what: string): void {
    this.missing.add(what);
  }

  sourceList(): SourceRef[] {
    return [...this.sources.values()];
  }

  connectorsRead(): string[] {
    return [...new Set(this.timings.filter((t) => t.outcome === "ok").map((t) => t.connector))];
  }
}
