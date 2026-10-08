/**
 * Page produit personnalisée.
 * Le contenu standard s'affiche tout de suite (lu chez la plateforme) ; chaque
 * personnalisation remplace un emplacement réservé. Si UA Intelligence ne
 * répond pas, la page reste la page standard : jamais d'erreur bloquante.
 */
import { useEffect, useState, type ReactNode } from "react";
import type { Reason, SourceRef, ToolResponseV1 } from "@uai/contracts";
import type { Client, PlatformProduct } from "../api";
import { ProductCarousel, SizePicker, StoreStock, type GenUiContext, type StockData } from "./GenUi";
import { ProductVisual } from "./ProductVisual";

type SlotState<T> = { state: "loading" } | { state: "ok"; res: ToolResponseV1<T> } | { state: "fallback"; reason: string };

interface LookData {
  items: { product: { id: string }; reasons: string[]; inStockInSize?: boolean }[];
}
interface SizeData {
  size?: string;
  source: "fit-specialist" | "profile" | "none";
  confidence?: number;
}

function useTool<T>(enabled: boolean, run: () => Promise<{ ok: true; data: ToolResponseV1<T> } | { ok: false; status: number; message: string }>, deps: unknown[]): SlotState<T> | undefined {
  const [s, setS] = useState<SlotState<T> | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return setS(undefined);
    let alive = true;
    setS({ state: "loading" });
    void run().then((r) => {
      if (!alive) return;
      setS(r.ok ? { state: "ok", res: r.data } : { state: "fallback", reason: r.status === 503 || r.status === 0 ? "Personnalisation indisponible : contenu standard." : r.message });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return s;
}

export function ProductPage({ product, products, client, signedIn, sessionKey, onSelectProduct }: {
  product: PlatformProduct;
  products: Map<string, PlatformProduct>;
  client: Client;
  signedIn: boolean;
  sessionKey: string;
  onSelectProduct: (id: string) => void;
}) {
  const deps = [product.id, sessionKey];
  const stock = useTool<StockData>(true, () => client.tool("check_store_stock", { productId: product.id }), deps);
  const look = useTool<LookData>(true, () => client.tool("complete_look", { productId: product.id }), deps);
  const size = useTool<SizeData>(signedIn, () => client.tool("recommend_size", { productId: product.id }), deps);

  const ctx: GenUiContext = { products, client, signedIn, onSelectProduct };
  const fmt = new Intl.NumberFormat("fr-FR", { style: "currency", currency: product.price.currency });

  return (
    <article className="pdp">
      <div className="pdp-main">
        <ProductVisual category={product.category} color={product.color} size={220} />
        <div className="pdp-info">
          <h1>{product.title}</h1>
          <div className="pdp-price">{fmt.format(product.price.amount)}</div>
          <div className="muted">Couleur : {product.color}</div>

          <Slot title="Votre taille" state={signedIn ? size : undefined} minHeight={84} empty={<SizePicker productId={product.id} ctx={ctx} />}>
            {(r: ToolResponseV1<SizeData>) => (
              <>
                <SizePicker productId={product.id} recommended={r.data.size} ctx={ctx} />
                <div className="muted small">
                  {r.data.source === "fit-specialist" && `Recommandée par le spécialiste taille (confiance ${Math.round((r.data.confidence ?? 0) * 100)} %)`}
                  {r.data.source === "profile" && "Votre taille habituelle (pas de spécialiste taille chez cette marque)"}
                  {r.data.source === "none" && "Pas de recommandation possible"}
                </div>
              </>
            )}
          </Slot>
          {!signedIn && <p className="muted small">Connectez-vous pour une taille conseillée et votre magasin en premier.</p>}
          <button className="btn primary" disabled>
            Ajouter au panier
          </button>
        </div>
      </div>

      <Slot title="Disponibilité en magasin" state={stock} minHeight={170}>
        {(r: ToolResponseV1<StockData>) => <StoreStock productId={product.id} size={r.data.size} storeIds={[]} ctx={{ ...ctx, stockData: r.data }} />}
      </Slot>

      <Slot title="Complétez la tenue" state={look} minHeight={200}>
        {(r: ToolResponseV1<LookData>) =>
          r.data.items.length ? (
            <ProductCarousel heading="" ids={r.data.items.map((i) => i.product.id)} ctx={{ ...ctx, details: Object.fromEntries(r.data.items.map((i) => [i.product.id, i.reasons])) }} />
          ) : (
            <div className="muted">Aucune pièce en stock à proposer.</div>
          )
        }
      </Slot>
    </article>
  );
}

function Slot<T>({ title, state, minHeight, children, empty }: {
  title: string;
  state: SlotState<T> | undefined;
  minHeight: number;
  children: (r: ToolResponseV1<T>) => ReactNode;
  empty?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="slot" style={{ minHeight }}>
      <header className="slot-head">
        <h2>{title}</h2>
        {state?.state === "ok" && (
          <div className="slot-meta">
            {state.res.partial && <span className="badge warn" title={`Manquant : ${state.res.missing.join(", ")}`}>Réponse partielle</span>}
            <span className="muted small">{state.res.meta.durationMs} ms</span>
            <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>
              Pourquoi ?
            </button>
          </div>
        )}
      </header>
      {!state && empty}
      {state?.state === "loading" && <div className="skeleton-lines" aria-busy="true" />}
      {state?.state === "fallback" && (empty ?? <div className="muted">{state.reason}</div>)}
      {state?.state === "ok" && children(state.res)}
      {state?.state === "ok" && open && <Why reasons={state.res.reasons} sources={state.res.sources} missing={state.res.missing} rulesVersion={state.res.rulesVersion} />}
    </section>
  );
}

export function Why({ reasons, sources, missing, rulesVersion }: { reasons: Reason[]; sources: SourceRef[]; missing: string[]; rulesVersion?: string }) {
  return (
    <div className="why">
      {reasons.length > 0 && (
        <ul>
          {reasons.map((r, i) => (
            <li key={i}>
              <code>{r.rule}</code> {r.text}
            </li>
          ))}
        </ul>
      )}
      <div className="muted small">
        Sources : {sources.map((s) => s.vendor).join(" · ") || "—"}
        {missing.length > 0 && ` · Manquant : ${missing.join(", ")}`}
        {rulesVersion && ` · Règles ${rulesVersion}`}
      </div>
    </div>
  );
}
