/**
 * Actions de l'acheteur (écritures déléguées aux systèmes sources, D1)
 * et résumé client pour le service client (niveau Interne).
 */
import { createHmac } from "node:crypto";
import type { ToolInput, ToolOutput } from "@uai/contracts";
import { UaiError, sha256, type IdentityMap, type RequestScope, type SecretVault } from "@uai/core";
import type { SourceGateway } from "@uai/connectors";
import { getProduct, getProducts, variantFor } from "../catalog.js";

export async function subscribeRestock(
  gateway: SourceGateway,
  scope: RequestScope,
  input: ToolInput<"subscribe_restock">,
): Promise<{ data: ToolOutput<"subscribe_restock"> }> {
  const customer = scope.caller.customer;
  if (!customer?.links.commerce) throw new UaiError("forbidden", "Session acheteur requise.");
  const product = await getProduct(gateway, scope, input.productId);
  const variant = variantFor(product, input.size);
  if (!variant) throw new UaiError("invalid_input", `Taille inconnue pour ce produit : ${input.size}`);
  // Clé d'idempotence : rejouer l'appel ne crée pas de doublon.
  const idempotencyKey = sha256(`${scope.tenant.id}|${customer.pseudoId}|${variant.sku}`);
  const r = await gateway.call(scope, "restock.subscribe", { externalId: customer.links.commerce, sku: variant.sku, idempotencyKey });
  if (!r.ok) throw new UaiError("unavailable", "Service d'alerte de réassort indisponible.");
  scope.addReason("R-ACTION-RESTOCK", "Abonnement enregistré dans l'outil de la marque, pas chez UA Intelligence.");
  return { data: { accepted: r.value.accepted, reference: r.value.reference } };
}

export async function prepareCart(
  gateway: SourceGateway,
  scope: RequestScope,
  vault: SecretVault,
  input: ToolInput<"prepare_cart">,
): Promise<{ data: ToolOutput<"prepare_cart"> }> {
  const customer = scope.caller.customer;
  if (!customer) throw new UaiError("forbidden", "Session acheteur requise.");
  const products = await getProducts(gateway, scope, input.items.map((i) => i.productId));
  const items = input.items.map((i) => {
    const p = products.find((x) => x.id === i.productId);
    const v = p && variantFor(p, i.size);
    if (!v) throw new UaiError("invalid_input", `Article invalide : ${i.productId} / ${i.size}`);
    return { sku: v.sku, qty: i.qty };
  });
  const idempotencyKey = sha256(`${scope.tenant.id}|${customer.pseudoId}|${JSON.stringify(items)}`);
  const r = await gateway.call(scope, "cart.prepare", { items, idempotencyKey });
  if (!r.ok || !r.value.url) throw new UaiError("unavailable", "Préparation du panier indisponible.");
  // Lien signé : aucun champ libre, SKU et quantités validés ci-dessus.
  const sig = createHmac("sha256", vault.get(scope.tenant.id, "cart-signing")).update(r.value.url).digest("base64url").slice(0, 22);
  const url = `${r.value.url}${r.value.url.includes("?") ? "&" : "?"}uai_sig=${sig}`;
  scope.addReason("R-ACTION-CART", "Panier créé chez la plateforme ; l'acheteur le valide lui-même.");
  return { data: { url, reference: r.value.reference } };
}

export async function getCustomerSummary(
  gateway: SourceGateway,
  scope: RequestScope,
  identity: IdentityMap,
  input: ToolInput<"get_customer_summary">,
): Promise<{ data: ToolOutput<"get_customer_summary">; customerRef: string }> {
  const links = identity.get(scope.tenant.id, input.customerRef);
  if (!links?.commerce) throw new UaiError("not_found", "Client inconnu.");
  const [consent, profile, loyalty, history, stores] = await Promise.all([
    gateway.call(scope, "consent.read", { externalId: links.consent ?? links.commerce }),
    gateway.call(scope, "customer.profile.read", { externalId: links.commerce }),
    links.loyalty ? gateway.call(scope, "loyalty.read", { externalId: links.loyalty }) : undefined,
    links.orders ? gateway.call(scope, "orders.history.read", { externalId: links.orders }) : undefined,
    gateway.call(scope, "stores.list", {}),
  ]);
  scope.consent = consent.ok && consent.value?.personalization ? "granted" : "refused";
  const p = profile.ok ? profile.value : null;
  const storeName = stores.ok ? stores.value.find((s) => s.id === p?.preferredStoreId)?.name : undefined;
  scope.addReason("R-SAV-MOTIF", `Consultation tracée avec le motif : « ${scope.caller.motif ?? ""} ».`);
  return {
    customerRef: input.customerRef,
    data: {
      customerRef: input.customerRef,
      ...(p?.firstName ? { firstName: p.firstName } : {}),
      ...(loyalty?.ok && loyalty.value ? { tier: loyalty.value.tier } : {}),
      ...(p?.usualSize ? { usualSize: p.usualSize } : {}),
      ...(storeName ? { preferredStore: storeName } : {}),
      recentCategories: history?.ok && history.value ? history.value.recentCategories : [],
      personalizationConsent: scope.consent === "granted",
    },
  };
}
