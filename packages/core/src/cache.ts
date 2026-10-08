/**
 * Cache par client (Redis en production, mémoire ici).
 *
 * - préfixe client imposé en un seul point : impossible de lire la clé d'un autre client (S3) ;
 * - coalescence des requêtes identiques en vol (singleflight, L4) ;
 * - stale-while-revalidate : on sert la valeur périmée et on rafraîchit en tâche de fond (L4) ;
 * - expirations étalées (jitter) pour éviter la ruée à l'expiration (L4) ;
 * - si le stockage principal tombe, cache local de secours (D4).
 */
export type CacheOutcome = "hit" | "miss" | "stale" | "coalesced";

export interface CacheEntry {
  value: unknown;
  freshUntil: number;
  staleUntil: number;
}

export interface CacheStore {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): Promise<void>;
  deleteByPrefix(prefix: string): Promise<number>;
}

export class MemoryStore implements CacheStore {
  private readonly map = new Map<string, CacheEntry>();
  constructor(private readonly maxEntries = 10_000) {}
  async get(key: string) {
    return this.map.get(key);
  }
  async set(key: string, entry: CacheEntry) {
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, entry);
  }
  async deleteByPrefix(prefix: string) {
    let n = 0;
    for (const k of [...this.map.keys()]) if (k.startsWith(prefix)) n += Number(this.map.delete(k));
    return n;
  }
}

/** Stockage principal + secours local. `down` simule une panne du principal (démo). */
export class FailoverStore implements CacheStore {
  public down = false;
  public failovers = 0;
  constructor(
    private readonly primary: CacheStore,
    private readonly local: CacheStore = new MemoryStore(1_000),
  ) {}
  private async attempt<T>(op: (s: CacheStore) => Promise<T>): Promise<T> {
    try {
      if (this.down) throw new Error("cache principal indisponible");
      return await op(this.primary);
    } catch {
      this.failovers++;
      return op(this.local);
    }
  }
  get(key: string) {
    return this.attempt((s) => s.get(key));
  }
  set(key: string, entry: CacheEntry) {
    return this.attempt((s) => s.set(key, entry));
  }
  deleteByPrefix(prefix: string) {
    return this.attempt((s) => s.deleteByPrefix(prefix));
  }
}

export interface CacheStats {
  hit: number;
  miss: number;
  stale: number;
  coalesced: number;
}

export class TenantCache {
  private readonly inflight = new Map<string, Promise<unknown>>();
  readonly stats: CacheStats = { hit: 0, miss: 0, stale: 0, coalesced: 0 };

  constructor(
    private readonly store: CacheStore,
    private readonly opts: { jitter?: number; staleFactor?: number; now?: () => number } = {},
  ) {}

  /** Vue cloisonnée sur un client : le seul moyen de lire ou écrire le cache. */
  forTenant(tenantId: string): ScopedCache {
    if (!/^[a-z0-9-]+$/.test(tenantId)) throw new Error("identifiant client invalide");
    return new ScopedCache(this, `t:${tenantId}:`);
  }

  private now() {
    return this.opts.now?.() ?? Date.now();
  }

  /** @internal utilisé par ScopedCache */
  async _getOrLoad<T>(fullKey: string, ttlSeconds: number, loader: () => Promise<T>): Promise<{ value: T; cache: CacheOutcome }> {
    if (ttlSeconds <= 0) {
      this.stats.miss++;
      return { value: await loader(), cache: "miss" };
    }
    const entry = await this.store.get(fullKey);
    const now = this.now();
    if (entry && entry.freshUntil > now) {
      this.stats.hit++;
      return { value: entry.value as T, cache: "hit" };
    }
    if (entry && entry.staleUntil > now) {
      this.stats.stale++;
      void this.load(fullKey, ttlSeconds, loader).catch(() => undefined);
      return { value: entry.value as T, cache: "stale" };
    }
    const pending = this.inflight.get(fullKey);
    if (pending) {
      this.stats.coalesced++;
      return { value: (await pending) as T, cache: "coalesced" };
    }
    this.stats.miss++;
    return { value: await this.load(fullKey, ttlSeconds, loader), cache: "miss" };
  }

  private load<T>(fullKey: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(fullKey);
    if (existing) return existing as Promise<T>;
    const p = (async () => {
      try {
        const value = await loader();
        const jitter = this.opts.jitter ?? 0.1;
        const ttlMs = ttlSeconds * 1000 * (1 - jitter + Math.random() * 2 * jitter);
        const now = this.now();
        await this.store.set(fullKey, {
          value,
          freshUntil: now + ttlMs,
          staleUntil: now + ttlMs * (1 + (this.opts.staleFactor ?? 1)),
        });
        return value;
      } finally {
        this.inflight.delete(fullKey);
      }
    })();
    this.inflight.set(fullKey, p);
    return p;
  }

  /** @internal */
  _invalidate(prefix: string) {
    return this.store.deleteByPrefix(prefix);
  }
}

export class ScopedCache {
  constructor(
    private readonly parent: TenantCache,
    private readonly prefix: string,
  ) {}
  getOrLoad<T>(key: string, ttlSeconds: number, loader: () => Promise<T>) {
    return this.parent._getOrLoad<T>(this.prefix + key, ttlSeconds, loader);
  }
  /** Invalidation ciblée (webhooks stock et prix). */
  invalidate(keyPrefix: string) {
    return this.parent._invalidate(this.prefix + keyPrefix);
  }
}
