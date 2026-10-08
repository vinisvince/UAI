/**
 * Assemblage du socle : une fonction pour l'API REST, le serveur MCP et les tests.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  FailoverStore,
  IdentityMap,
  Journal,
  MemoryStore,
  RateLimiter,
  SecretVault,
  TenantCache,
  TenantRegistry,
  issueSessionToken,
  type Caller,
  type Credentials,
  resolveCaller,
} from "@uai/core";
import { ConnectorRegistry, DEFAULT_SIMULATION, SimulationControl, SourceGateway, seedIdentity } from "@uai/connectors";
import { ToolExecutor } from "./tools.js";

export const DEFAULT_CONFIG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../config/tenants");

export interface RuntimeOptions {
  configDir?: string;
  /** "instant" supprime la latence simulée (tests). */
  simulation?: "default" | "instant";
  journalDir?: string;
}

export function createRuntime(opts: RuntimeOptions = {}) {
  const tenants = TenantRegistry.fromDirectory(opts.configDir ?? DEFAULT_CONFIG_DIR);
  const vault = new SecretVault();
  vault.ensureDevSecrets(tenants.list().map((t) => t.id));
  const identity = new IdentityMap(vault);
  seedIdentity(identity);

  const sim = new SimulationControl(DEFAULT_SIMULATION);
  sim.instant = opts.simulation === "instant";
  const cacheStore = new FailoverStore(new MemoryStore());
  const cache = new TenantCache(cacheStore);
  const registry = new ConnectorRegistry(tenants.list(), sim);
  const gateway = new SourceGateway(registry, cache);
  const journal = new Journal(opts.journalDir ? { dir: opts.journalDir } : {});
  const rateLimiter = new RateLimiter();
  const executor = new ToolExecutor({ gateway, identity, vault, journal, rateLimiter });

  return {
    tenants,
    vault,
    identity,
    sim,
    cache,
    cacheStore,
    registry,
    gateway,
    journal,
    rateLimiter,
    executor,
    authenticate: (creds: Credentials): Caller => resolveCaller(creds, { tenants, vault, identity }),
    /** Démo uniquement : simule l'émission d'un jeton par la plateforme (SLAS, Shopify). */
    issueDemoSession: (tenantId: string, externalId: string, ttlSeconds = 3600) =>
      issueSessionToken(vault.get(tenantId, "session-signing"), { tid: tenantId, sub: externalId, exp: Math.floor(Date.now() / 1000) + ttlSeconds }),
  };
}

export type Runtime = ReturnType<typeof createRuntime>;
