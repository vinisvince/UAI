/**
 * Client de l'API UA Intelligence pour la démo.
 * Le front ne transmet jamais d'identifiant client : seulement sa clé et le
 * jeton de session émis par la plateforme.
 */
import type { ChatResponse, ToolName, ToolResponseV1 } from "@uai/contracts";

export interface PlatformProduct {
  id: string;
  title: string;
  price: { amount: number; currency: string };
  color: string;
  category: string;
  sizes: string[];
}

export interface DemoTenant {
  id: string;
  name: string;
  platform: "sfcc" | "shopify";
  keys: { public: string; front: string; service: string };
  personas: { externalId: string; label: string }[];
  connectors: { id: string; vendor: string; access: string; capabilities: string[] }[];
  genUi: string[];
}

export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string; message: string };

export interface ToolLog {
  at: number;
  tool: string;
  response?: ToolResponseV1;
  status: number;
  error?: string;
}

type Listener = (log: ToolLog) => void;
const listeners = new Set<Listener>();
export const onToolCall = (l: Listener) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

async function request<T>(path: string, init: RequestInit & { key?: string; token?: string } = {}): Promise<Result<T>> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.key) headers["x-api-key"] = init.key;
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  try {
    const res = await fetch(path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, error: String(body.error ?? "error"), message: String(body.message ?? res.statusText) };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, status: 0, error: "network", message: "API injoignable" };
  }
}

export function createClient(key: string, token?: string) {
  return {
    async tool<T = unknown>(name: ToolName, input: unknown): Promise<Result<ToolResponseV1<T>>> {
      const r = await request<ToolResponseV1<T>>(`/v1/tools/${name}`, { method: "POST", body: JSON.stringify(input), key, token });
      const log: ToolLog = r.ok
        ? { at: Date.now(), tool: name, response: r.data as ToolResponseV1, status: 200 }
        : { at: Date.now(), tool: name, status: r.status, error: r.message };
      listeners.forEach((l) => l(log));
      return r;
    },
    chat(message: string, productId?: string) {
      return request<ChatResponse>("/v1/chat", { method: "POST", body: JSON.stringify({ message, ...(productId ? { page: { productId } } : {}) }), key, token });
    },
    platformProducts() {
      return request<{ products: PlatformProduct[] }>("/demo/platform/products", { key });
    },
    session(externalId: string) {
      return request<{ token: string; customerRef: string; label: string }>("/demo/session", { method: "POST", body: JSON.stringify({ externalId }), key });
    },
    journal() {
      return request<{ entries: JournalEntry[]; integrity: { ok: boolean; brokenAt?: number } }>("/demo/journal", { key });
    },
  };
}
export type Client = ReturnType<typeof createClient>;

export interface JournalEntry {
  seq: number;
  at: string;
  channel: string;
  tool: string;
  caller: { level: string; keyLabel: string };
  consent: string;
  partial: boolean;
  outcome: string;
  durationMs: number;
  connectorsRead: string[];
  customerRef?: string;
  hash: string;
  aiGenerated?: boolean;
}

export interface SimulationState {
  connectors: Record<string, { latencyMs: [number, number]; down: boolean; slowFactor: number; failureRate: number }>;
  layerDown: boolean;
  cacheDown: boolean;
  llmMode: "normal" | "down" | "hallucinate";
  cache: { hit: number; miss: number; stale: number; coalesced: number };
}

export const demoApi = {
  tenants: () => request<DemoTenant[]>("/demo/tenants"),
  simulation: () => request<SimulationState>("/demo/simulation"),
  setSimulation: (patch: Record<string, unknown>) => request<{ ok: true }>("/demo/simulation", { method: "POST", body: JSON.stringify(patch) }),
};
