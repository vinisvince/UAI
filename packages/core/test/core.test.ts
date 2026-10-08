import { describe, expect, it } from "vitest";
import {
  IdentityMap,
  Journal,
  MemoryStore,
  FailoverStore,
  RateLimiter,
  SecretVault,
  TenantCache,
  TenantRegistry,
  UaiError,
  issueSessionToken,
  resolveCaller,
  runWithBudget,
  sleep,
} from "../src/index.js";
import { DEFAULT_CONFIG_DIR } from "../../engine/src/runtime.js";

function deps() {
  const tenants = TenantRegistry.fromDirectory(DEFAULT_CONFIG_DIR);
  const vault = new SecretVault();
  vault.ensureDevSecrets(tenants.list().map((t) => t.id));
  return { tenants, vault, identity: new IdentityMap(vault) };
}

describe("Résolution de l'appelant (S1, S2, S3)", () => {
  it("le client est déduit de la clé", () => {
    const d = deps();
    expect(resolveCaller({ apiKey: "pk_lune_partner_demo" }, d).tenant.id).toBe("maison-lune");
    expect(() => resolveCaller({ apiKey: "inconnue" }, d)).toThrow(UaiError);
    expect(() => resolveCaller({}, d)).toThrow(/manquante/);
  });

  it("une session d'un autre client est refusée", () => {
    const d = deps();
    const celioToken = issueSessionToken(d.vault.get("celio", "session-signing"), { tid: "celio", sub: "c-1001", exp: Date.now() / 1000 + 60 });
    expect(() => resolveCaller({ apiKey: "fk_lune_shop_demo", sessionToken: celioToken }, d)).toThrow(/invalide/);
  });

  it("une session expirée ou falsifiée est refusée", () => {
    const d = deps();
    const secret = d.vault.get("celio", "session-signing");
    const expired = issueSessionToken(secret, { tid: "celio", sub: "c-1001", exp: Math.floor(Date.now() / 1000) - 10 });
    expect(() => resolveCaller({ apiKey: "fk_celio_site_demo", sessionToken: expired }, d)).toThrow(/expired/);
    const forged = issueSessionToken("autre-secret", { tid: "celio", sub: "c-1002", exp: Math.floor(Date.now() / 1000) + 60 });
    expect(() => resolveCaller({ apiKey: "fk_celio_site_demo", sessionToken: forged }, d)).toThrow(/bad_signature/);
  });

  it("une session valide donne le niveau session et un pseudonyme, jamais l'identifiant brut", () => {
    const d = deps();
    const tok = issueSessionToken(d.vault.get("celio", "session-signing"), { tid: "celio", sub: "c-1001", exp: Math.floor(Date.now() / 1000) + 60 });
    const c = resolveCaller({ apiKey: "fk_celio_site_demo", sessionToken: tok }, d);
    expect(c.level).toBe("session");
    expect(c.customer?.pseudoId).toMatch(/^c_[0-9a-f]{20}$/);
    expect(c.customer?.pseudoId).not.toContain("1001");
  });

  it("une clé publique ne peut pas agir pour un client (niveau Délégué fermé)", () => {
    const d = deps();
    expect(() => resolveCaller({ apiKey: "pk_celio_partner_demo", sessionToken: "x.y" }, d)).toThrow(/Délégué/);
  });

  it("le niveau interne exige un rôle autorisé et un motif", () => {
    const d = deps();
    expect(() => resolveCaller({ apiKey: "sk_celio_sav_demo" }, d)).toThrow(/Rôle/);
    expect(() => resolveCaller({ apiKey: "sk_celio_sav_demo", role: "sav" }, d)).toThrow(/Motif/);
    expect(resolveCaller({ apiKey: "sk_celio_sav_demo", role: "sav", motif: "Réclamation commande" }, d).level).toBe("interne");
  });

  it("le pseudonyme dépend du client : le même identifiant donne deux pseudonymes", () => {
    const d = deps();
    expect(d.identity.pseudonymize("celio", "X")).not.toBe(d.identity.pseudonymize("maison-lune", "X"));
  });
});

describe("Cache cloisonné (S3, L4, D4)", () => {
  it("un client ne lit jamais la clé d'un autre", async () => {
    const cache = new TenantCache(new MemoryStore());
    await cache.forTenant("celio").getOrLoad("k", 60, async () => "celio");
    const r = await cache.forTenant("maison-lune").getOrLoad("k", 60, async () => "lune");
    expect(r.value).toBe("lune");
    expect(() => cache.forTenant("../celio")).toThrow();
  });

  it("coalesce les requêtes identiques en vol (un seul chargement)", async () => {
    const cache = new TenantCache(new MemoryStore()).forTenant("celio");
    let loads = 0;
    const loader = async () => {
      loads++;
      await sleep(30);
      return 42;
    };
    const rs = await Promise.all([cache.getOrLoad("k", 60, loader), cache.getOrLoad("k", 60, loader), cache.getOrLoad("k", 60, loader)]);
    expect(loads).toBe(1);
    expect(rs.map((r) => r.cache).sort()).toEqual(["coalesced", "coalesced", "miss"]);
  });

  it("sert la valeur périmée et rafraîchit en tâche de fond", async () => {
    let now = 0;
    const cache = new TenantCache(new MemoryStore(), { jitter: 0, now: () => now }).forTenant("celio");
    await cache.getOrLoad("k", 10, async () => "v1");
    now = 15_000; // périmé mais dans la fenêtre stale
    const r = await cache.getOrLoad("k", 10, async () => "v2");
    expect(r).toEqual({ value: "v1", cache: "stale" });
    await sleep(5);
    expect((await cache.getOrLoad("k", 10, async () => "v3")).value).toBe("v2");
  });

  it("bascule sur le cache local si le principal tombe", async () => {
    const store = new FailoverStore(new MemoryStore());
    store.down = true;
    const cache = new TenantCache(store).forTenant("celio");
    await cache.getOrLoad("k", 60, async () => 1);
    expect((await cache.getOrLoad("k", 60, async () => 2)).cache).toBe("hit");
    expect(store.failovers).toBeGreaterThan(0);
  });
});

describe("Budgets de temps (L1, L2)", () => {
  it("coupe un appel trop long", async () => {
    const r = await runWithBudget((signal) => sleep(200, signal).then(() => "fini"), 30);
    expect(r).toMatchObject({ ok: false, outcome: "timeout" });
  });
  it("laisse passer un appel dans son budget", async () => {
    const r = await runWithBudget(async () => "ok", 50);
    expect(r).toMatchObject({ ok: true, value: "ok" });
  });
});

describe("Journal (RGPD, AI Act)", () => {
  const entry = (tenantId: string, customerRef?: string) => ({
    requestId: "r",
    tenantId,
    caller: { level: "public" as const, keyLabel: "k" },
    channel: "rest" as const,
    tool: "search_products",
    consent: "not_required" as const,
    connectorsRead: ["x"],
    rulesVersion: "v",
    partial: false,
    outcome: "ok" as const,
    durationMs: 1,
    ...(customerRef ? { customerRef } : {}),
  });

  it("chaîne les entrées et détecte une falsification", () => {
    const j = new Journal();
    j.append(entry("celio"));
    j.append(entry("celio"));
    expect(j.verify("celio").ok).toBe(true);
    (j.list("celio")[0] as { tool: string }).tool = "modifié";
    expect(j.verify("celio").ok).toBe(false);
  });

  it("cloisonne par client et efface un client en re-scellant la chaîne", () => {
    const j = new Journal();
    j.append(entry("celio", "c_a"));
    j.append(entry("celio", "c_b"));
    j.append(entry("maison-lune", "c_a"));
    expect(j.eraseCustomer("celio", "c_a")).toBe(1);
    expect(j.verify("celio").ok).toBe(true);
    expect(j.list("celio").some((e) => e.customerRef === "c_a")).toBe(false);
    expect(j.list("maison-lune")[0]?.customerRef).toBe("c_a");
  });
});

describe("Quotas (S8)", () => {
  it("bloque au-delà du quota par minute", () => {
    const r = new RateLimiter(() => 0);
    for (let i = 0; i < 3; i++) expect(r.take("celio", "k", 3).ok).toBe(true);
    expect(r.take("celio", "k", 3).ok).toBe(false);
    expect(r.take("maison-lune", "k", 3).ok).toBe(true);
  });
});
