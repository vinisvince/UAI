/** Quotas par clé (S8) : fenêtre fixe d'une minute, cloisonnée par client. */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  take(tenantId: string, keyLabel: string, perMinute: number): { ok: boolean; remaining: number } {
    const k = `${tenantId}|${keyLabel}`;
    const t = this.now();
    const w = this.windows.get(k);
    if (!w || t - w.start >= 60_000) {
      this.windows.set(k, { start: t, count: 1 });
      return { ok: true, remaining: perMinute - 1 };
    }
    w.count++;
    return { ok: w.count <= perMinute, remaining: Math.max(0, perMinute - w.count) };
  }
}
