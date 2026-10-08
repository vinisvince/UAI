/** Recherche plein texte simplifiée des bouchons (insensible aux accents, synonymes). */
import type { Product } from "@uai/contracts";

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ");

const SYNONYMS: Record<string, string[]> = {
  chemise: ["chemise", "chemises", "oxford", "popeline", "lin"],
  tshirt: ["tshirt", "t", "shirt", "tee", "t-shirt"],
  pull: ["pull", "pulls", "maille", "cardigan", "roule", "camionneur", "sweat"],
  pantalon: ["pantalon", "pantalons", "chino", "jean", "jeans", "costume"],
  veste: ["veste", "vestes", "blazer", "doudoune", "surchemise", "manteau"],
  chaussures: ["chaussures", "sneakers", "baskets", "mocassins"],
  accessoire: ["accessoire", "ceinture", "bonnet"],
};

const STOP = new Set(["un", "une", "des", "de", "du", "le", "la", "les", "pour", "en", "et", "je", "cherche", "veux", "voudrais", "homme", "femme", "avec", "a", "moi"]);

export function searchCatalog(products: Product[], text: string, opts: { category?: string; maxPrice?: number; limit?: number } = {}): string[] {
  const tokens = norm(text).split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t));
  const scored = products
    .filter((p) => (opts.category ? p.category === opts.category : true))
    .filter((p) => (opts.maxPrice ? p.price.amount <= opts.maxPrice : true))
    .map((p) => {
      const hay = norm([p.title, p.category, p.color, ...p.styleTags].join(" "));
      let score = 0;
      for (const t of tokens) {
        if (hay.split(" ").includes(t)) score += 2;
        else if (hay.includes(t)) score += 1;
        const syn = Object.entries(SYNONYMS).find(([, words]) => words.includes(t));
        if (syn && syn[0] === p.category) score += 2;
      }
      return { id: p.id, score };
    })
    .filter((x) => (tokens.length ? x.score > 0 : true))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, opts.limit ?? 8).map((x) => x.id);
}
