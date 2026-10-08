/**
 * Brique Fit : taille recommandée via un spécialiste quand le client en a un ;
 * sinon taille habituelle du profil (donnée déclarée, pas de modèle).
 */
import type { CustomerContext, ToolInput, ToolOutput, UiBlock } from "@uai/contracts";
import type { RequestScope } from "@uai/core";
import type { SourceGateway } from "@uai/connectors";
import { getProduct } from "../catalog.js";

export async function recommendSize(
  gateway: SourceGateway,
  scope: RequestScope,
  input: ToolInput<"recommend_size">,
  ctx?: CustomerContext,
): Promise<{ data: ToolOutput<"recommend_size">; ui: UiBlock }> {
  const product = await getProduct(gateway, scope, input.productId);
  const sizes = product.variants.map((v) => v.size);
  const ui = (size?: string): UiBlock => ({ component: "SizePicker", props: { productId: product.id, ...(size ? { recommendedSize: size } : {}) } });
  const profile = ctx?.profile;

  if (!profile) return { data: { productId: product.id, source: "none" }, ui: ui() };

  const fit = await gateway.call(scope, "fit.recommend", { productId: product.id, usualSize: profile.usualSize, fit: profile.fit });
  if (fit.ok && fit.value && sizes.includes(fit.value.size)) {
    scope.addReason("R-FIT-SPECIALIST", `Taille calculée par le spécialiste taille (confiance ${Math.round(fit.value.confidence * 100)} %).`);
    if (fit.value.size !== profile.usualSize) scope.addReason("R-FIT-ADJUST", `Coupe ${product.fit ?? ""} : une taille au-dessus de votre taille habituelle.`);
    addReturnsReason(scope, ctx, fit.value.size);
    return { data: { productId: product.id, size: fit.value.size, confidence: fit.value.confidence, source: "fit-specialist" }, ui: ui(fit.value.size) };
  }

  if (profile.usualSize && sizes.includes(profile.usualSize)) {
    scope.addReason("R-FIT-PROFILE", "Pas de spécialiste taille : taille habituelle déclarée dans votre profil.");
    addReturnsReason(scope, ctx, profile.usualSize);
    return { data: { productId: product.id, size: profile.usualSize, source: "profile" }, ui: ui(profile.usualSize) };
  }
  return { data: { productId: product.id, source: "none" }, ui: ui() };
}

function addReturnsReason(scope: RequestScope, ctx: CustomerContext | undefined, size: string) {
  const returns = ctx?.history?.returnsBySize?.[size];
  if (returns) scope.addReason("R-FIT-RETURNS", `${returns} retour(s) en taille ${size} : vérifiez le guide des tailles.`);
}
