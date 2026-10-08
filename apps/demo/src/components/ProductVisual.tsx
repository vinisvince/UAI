/** Visuel générique par catégorie (aucune image externe), teinté selon la couleur du produit. */
const COLORS: Record<string, string> = {
  "bleu ciel": "#9cc3e4",
  blanc: "#f1eee6",
  noir: "#2d2d2f",
  marine: "#24365c",
  gris: "#9a9ea3",
  beige: "#d6c3a0",
  brut: "#34445f",
  kaki: "#6d6c43",
  marron: "#6b4428",
  écru: "#ece2cc",
  camel: "#c19a6b",
  "vert sauge": "#9cae89",
  "bleu délavé": "#86a2c4",
  chocolat: "#4e3427",
  bordeaux: "#6d1f2c",
};

const SHAPES: Record<string, string> = {
  chemise: "M30 18 L46 12 Q50 18 54 12 L70 18 L84 34 L74 42 L70 38 L70 90 L30 90 L30 38 L26 42 L16 34 Z M50 16 L50 90",
  tshirt: "M32 16 L44 12 Q50 20 56 12 L68 16 L84 30 L74 40 L68 36 L68 90 L32 90 L32 36 L26 40 L16 30 Z",
  pull: "M32 16 L44 12 Q50 18 56 12 L68 16 L80 28 L86 76 L76 78 L70 42 L70 90 L30 90 L30 42 L24 78 L14 76 L20 28 Z",
  veste: "M30 16 L44 12 L50 30 L56 12 L70 16 L82 30 L86 82 L76 84 L70 44 L70 92 L30 92 L30 44 L24 84 L14 82 L18 30 Z M50 30 L50 92",
  pantalon: "M32 12 L68 12 L72 92 L56 92 L50 36 L44 92 L28 92 Z",
  chaussures: "M14 62 L40 58 L56 46 L66 48 L72 60 L86 64 Q88 74 80 76 L16 76 Q12 70 14 62 Z",
  accessoire: "M14 46 L86 46 L86 56 L14 56 Z M58 42 L72 42 L72 60 L58 60 Z",
};

export function ProductVisual({ category, color, size = 96 }: { category: string; color: string; size?: number }) {
  const fill = COLORS[color] ?? "#c9c4b8";
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`${category} ${color}`} className="visual">
      <rect x="0" y="0" width="100" height="100" rx="10" className="visual-bg" />
      <path d={SHAPES[category] ?? SHAPES.tshirt} fill={fill} stroke="rgba(0,0,0,.35)" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
