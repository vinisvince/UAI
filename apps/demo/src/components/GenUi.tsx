/**
 * Catalogue fermé de composants Gen UI de la marque.
 * Les composants reçoivent des IDENTIFIANTS ; prix et visuels sont résolus par
 * le front auprès de la plateforme ; le stock est relu via l'API.
 */
import { useEffect, useState } from "react";
import type { UiBlock } from "@uai/contracts";
import type { Client, PlatformProduct } from "../api";
import { ProductVisual } from "./ProductVisual";

export interface GenUiContext {
  products: Map<string, PlatformProduct>;
  client: Client;
  signedIn: boolean;
  onSelectProduct: (id: string) => void;
  /** Raisons par produit, quand le bloc vient d'un outil qui les fournit. */
  details?: Record<string, string[]>;
  /** Données d'outil déjà disponibles (évite un second appel). */
  stockData?: StockData;
}

export interface StockData {
  productId: string;
  size?: string;
  online: { status: string; sizes: { size: string; status: string }[] };
  stores: { storeId: string; name: string; city: string; status: string; quantity: number; preferred: boolean; updatedAt: string }[];
  restockSuggested: boolean;
}

const price = (p: PlatformProduct) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: p.price.currency }).format(p.price.amount);

export const STATUS_LABEL: Record<string, string> = { in_stock: "En stock", low: "Stock faible", out: "Rupture", unknown: "Inconnu" };

const HEADINGS: Record<string, string> = { look: "Pour compléter la tenue", search: "Résultats", recommendations: "Sélection pour vous" };

export function GenUiBlock({ block, ctx }: { block: UiBlock; ctx: GenUiContext }) {
  switch (block.component) {
    case "ProductCarousel":
      return <ProductCarousel heading={HEADINGS[block.props.heading] ?? ""} ids={block.props.productIds} ctx={ctx} />;
    case "ProductCard": {
      const p = ctx.products.get(block.props.productId);
      return p ? <ProductCard p={p} ctx={ctx} /> : null;
    }
    case "SizePicker":
      return <SizePicker productId={block.props.productId} recommended={block.props.recommendedSize} ctx={ctx} />;
    case "StoreStock":
      return <StoreStock productId={block.props.productId} size={block.props.size} storeIds={block.props.storeIds} ctx={ctx} />;
  }
}

export function ProductCarousel({ heading, ids, ctx }: { heading: string; ids: string[]; ctx: GenUiContext }) {
  const items = ids.map((id) => ctx.products.get(id)).filter((p): p is PlatformProduct => Boolean(p));
  return (
    <div className="genui">
      {heading && <div className="genui-heading">{heading}</div>}
      <div className="carousel">
        {items.map((p) => (
          <ProductCard key={p.id} p={p} ctx={ctx} />
        ))}
      </div>
    </div>
  );
}

export function ProductCard({ p, ctx }: { p: PlatformProduct; ctx: GenUiContext }) {
  const why = ctx.details?.[p.id];
  return (
    <button className="card" onClick={() => ctx.onSelectProduct(p.id)} title={why?.join(" · ")}>
      <ProductVisual category={p.category} color={p.color} size={84} />
      <span className="card-title">{p.title}</span>
      <span className="card-price">{price(p)}</span>
      {why && why.length > 0 && <span className="card-why">{why[0]}</span>}
    </button>
  );
}

export function SizePicker({ productId, recommended, ctx }: { productId: string; recommended?: string; ctx: GenUiContext }) {
  const p = ctx.products.get(productId);
  const [picked, setPicked] = useState(recommended);
  useEffect(() => setPicked(recommended), [recommended]);
  if (!p) return null;
  return (
    <div className="genui">
      <div className="sizes" role="radiogroup" aria-label="Taille">
        {p.sizes.map((s) => (
          <button key={s} role="radio" aria-checked={picked === s} className={`size ${picked === s ? "picked" : ""} ${recommended === s ? "recommended" : ""}`} onClick={() => setPicked(s)}>
            {s}
            {recommended === s && <small>conseillée</small>}
          </button>
        ))}
      </div>
    </div>
  );
}

const minutesAgo = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));

export function StoreStock({ productId, size, storeIds, ctx }: { productId: string; size?: string; storeIds: string[]; ctx: GenUiContext }) {
  const [data, setData] = useState<StockData | undefined>(ctx.stockData);
  const [restock, setRestock] = useState<"idle" | "pending" | "done" | "error">("idle");

  useEffect(() => {
    if (ctx.stockData) return setData(ctx.stockData);
    // Composant issu du chat : il relit le stock via l'API (les actions et les données repassent par l'API).
    let alive = true;
    void ctx.client.tool<StockData>("check_store_stock", { productId, ...(size ? { size } : {}) }).then((r) => alive && r.ok && setData(r.data.data));
    return () => {
      alive = false;
    };
  }, [productId, size, ctx.stockData, ctx.client]);

  if (!data) return <div className="genui skeleton-lines" aria-busy="true" />;
  const rows = storeIds.length ? storeIds.map((id) => data.stores.find((s) => s.storeId === id)).filter((s): s is StockData["stores"][number] => Boolean(s)) : data.stores;

  const subscribe = async () => {
    setRestock("pending");
    const r = await ctx.client.tool("subscribe_restock", { productId, size: data.size ?? size ?? "M" });
    setRestock(r.ok ? "done" : "error");
  };

  return (
    <div className="genui">
      <div className="stock-online">
        En ligne{data.size ? ` (taille ${data.size})` : ""} : <span className={`pill ${data.online.status}`}>{STATUS_LABEL[data.online.status]}</span>
      </div>
      {rows.length === 0 && <div className="muted">Aucune information magasin pour le moment.</div>}
      <ul className="stores">
        {rows.map((s) => (
          <li key={s.storeId}>
            <div>
              <strong>{s.name}</strong> {s.preferred && <span className="badge">Votre magasin</span>}
              <div className="muted small">
                {s.city} · mis à jour il y a {minutesAgo(s.updatedAt)} min
              </div>
            </div>
            <span className={`pill ${s.status}`}>{STATUS_LABEL[s.status]}</span>
          </li>
        ))}
      </ul>
      {data.restockSuggested && (
        <div className="restock">
          {ctx.signedIn ? (
            <button className="btn" disabled={restock === "pending" || restock === "done"} onClick={subscribe}>
              {restock === "done" ? "Alerte enregistrée" : restock === "error" ? "Réessayer" : "Me prévenir du réassort"}
            </button>
          ) : (
            <span className="muted">Rupture partout. Connectez-vous pour être prévenu du réassort.</span>
          )}
        </div>
      )}
    </div>
  );
}
