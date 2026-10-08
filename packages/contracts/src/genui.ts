/**
 * Spécification Gen UI (contrat 3 du mémo).
 *
 * Le modèle choisit un composant du catalogue fermé de la marque et le
 * remplit avec des IDENTIFIANTS. Le front résout lui-même prix et visuels.
 * Aucune donnée affichée n'est produite par le modèle.
 */
import { z } from "zod";

export const UI_COMPONENTS = ["ProductCarousel", "ProductCard", "SizePicker", "StoreStock"] as const;
export const UiComponentName = z.enum(UI_COMPONENTS);
export type UiComponentName = z.infer<typeof UiComponentName>;

const Id = z.string().min(1).max(64);

export const ProductCarouselBlock = z
  .object({
    component: z.literal("ProductCarousel"),
    props: z.object({
      /** Titre de section choisi parmi des libellés fixes, pas du texte libre. */
      heading: z.enum(["look", "search", "recommendations"]),
      productIds: z.array(Id).min(1).max(8),
    }).strict(),
  })
  .strict();

export const ProductCardBlock = z
  .object({
    component: z.literal("ProductCard"),
    props: z.object({ productId: Id }).strict(),
  })
  .strict();

export const SizePickerBlock = z
  .object({
    component: z.literal("SizePicker"),
    props: z.object({
      productId: Id,
      /** Doit provenir d'un résultat d'outil du même tour. */
      recommendedSize: z.string().max(8).optional(),
    }).strict(),
  })
  .strict();

export const StoreStockBlock = z
  .object({
    component: z.literal("StoreStock"),
    props: z.object({
      productId: Id,
      size: z.string().max(8).optional(),
      storeIds: z.array(Id).max(5),
    }).strict(),
  })
  .strict();

export const UiBlock = z.discriminatedUnion("component", [
  ProductCarouselBlock,
  ProductCardBlock,
  SizePickerBlock,
  StoreStockBlock,
]);
export type UiBlock = z.infer<typeof UiBlock>;

/**
 * Identifiants qu'un bloc a le droit de référencer : ceux renvoyés par les
 * outils exécutés pendant le même tour (validation sémantique, risque S5).
 */
export interface UiAllowedIds {
  productIds: Set<string>;
  storeIds: Set<string>;
  sizes: Map<string, Set<string>>; // productId -> tailles connues
}

export type UiValidation = { ok: true; block: UiBlock } | { ok: false; errors: string[] };

export function validateUiBlock(
  raw: unknown,
  catalog: readonly UiComponentName[],
  allowed: UiAllowedIds,
): UiValidation {
  const parsed = UiBlock.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const block = parsed.data;
  const errors: string[] = [];
  if (!catalog.includes(block.component)) {
    errors.push(`composant hors catalogue du client : ${block.component}`);
  }
  const checkProduct = (id: string) => {
    if (!allowed.productIds.has(id)) errors.push(`produit non issu des outils du tour : ${id}`);
  };
  switch (block.component) {
    case "ProductCarousel":
      block.props.productIds.forEach(checkProduct);
      break;
    case "ProductCard":
      checkProduct(block.props.productId);
      break;
    case "SizePicker": {
      checkProduct(block.props.productId);
      const size = block.props.recommendedSize;
      if (size && !allowed.sizes.get(block.props.productId)?.has(size)) {
        errors.push(`taille non issue des outils du tour : ${size}`);
      }
      break;
    }
    case "StoreStock":
      checkProduct(block.props.productId);
      block.props.storeIds.forEach((s) => {
        if (!allowed.storeIds.has(s)) errors.push(`magasin non issu des outils du tour : ${s}`);
      });
      break;
  }
  return errors.length ? { ok: false, errors } : { ok: true, block };
}
