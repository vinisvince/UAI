import { useEffect, useMemo, useState } from "react";
import { createClient, demoApi, type DemoTenant, type PlatformProduct } from "./api";
import { Chat } from "./components/Chat";
import { ProductPage } from "./components/ProductPage";
import { ProductVisual } from "./components/ProductVisual";
import { TechPanel } from "./components/TechPanel";

export function App() {
  const [tenants, setTenants] = useState<DemoTenant[]>([]);
  const [tenantId, setTenantId] = useState("celio");
  const [personaId, setPersonaId] = useState("");
  const [session, setSession] = useState<{ token: string; label: string; customerRef: string }>();
  const [products, setProducts] = useState<PlatformProduct[]>([]);
  const [productId, setProductId] = useState<string>();
  const [tech, setTech] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [apiDown, setApiDown] = useState(false);

  useEffect(() => {
    void demoApi.tenants().then((r) => (r.ok ? setTenants(r.data) : setApiDown(true)));
  }, []);

  const tenant = tenants.find((t) => t.id === tenantId);
  const baseClient = useMemo(() => (tenant ? createClient(tenant.keys.front) : undefined), [tenant]);
  const client = useMemo(() => (tenant ? createClient(tenant.keys.front, session?.token) : undefined), [tenant, session]);

  // Contenu standard : lu directement chez la plateforme, sans UA Intelligence.
  useEffect(() => {
    if (!baseClient) return;
    setPersonaId("");
    setSession(undefined);
    void baseClient.platformProducts().then((r) => {
      if (!r.ok) return;
      setProducts(r.data.products);
      setProductId(r.data.products[0]?.id);
    });
  }, [baseClient]);

  useEffect(() => {
    if (!baseClient) return;
    if (!personaId) return setSession(undefined);
    void baseClient.session(personaId).then((r) => r.ok && setSession(r.data));
  }, [personaId, baseClient]);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const product = productId ? productMap.get(productId) : undefined;
  const signedIn = Boolean(session);
  const sessionKey = `${session?.token ?? "anon"}|${refresh}`;

  if (apiDown) {
    return (
      <div className="boot">
        <h1>API injoignable</h1>
        <p>
          Lancez l'API : <code>pnpm dev</code> à la racine du dépôt.
        </p>
      </div>
    );
  }
  if (!tenant || !client || !product) return <div className="boot">Chargement…</div>;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>UA Intelligence</strong>
          <span className="muted">démo · données simulées</span>
        </div>
        <label>
          Marque
          <select value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.platform === "sfcc" ? "Salesforce" : "Shopify"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Visiteur
          <select value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
            <option value="">Anonyme (niveau public)</option>
            {tenant.personas.map((p) => (
              <option key={p.externalId} value={p.externalId}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="switch">
          <input type="checkbox" checked={tech} onChange={(e) => setTech(e.target.checked)} /> Panneau technique
        </label>
      </header>

      <nav className="catalog" aria-label="Catalogue">
        {products.map((p) => (
          <button key={p.id} className={`thumb ${p.id === productId ? "active" : ""}`} onClick={() => setProductId(p.id)} title={p.title}>
            <ProductVisual category={p.category} color={p.color} size={44} />
            <span>{p.title}</span>
          </button>
        ))}
      </nav>

      <main className="layout">
        <ProductPage product={product} products={productMap} client={client} signedIn={signedIn} sessionKey={sessionKey} onSelectProduct={setProductId} />
        <Chat client={client} products={productMap} product={product} signedIn={signedIn} onSelectProduct={setProductId} resetKey={`${tenantId}|${personaId}`} />
      </main>

      {tech && <TechPanel tenant={tenant} client={client} onChange={() => setRefresh((n) => n + 1)} />}
    </div>
  );
}
