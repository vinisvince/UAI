/**
 * Couche 4 — Contexte client assemblé à la demande, jamais stocké.
 * Seuls les champs déclarés par l'outil sont lus (L5, minimisation RGPD).
 * Le consentement est lu en premier : refusé, aucun autre champ n'est lu.
 */
import type { ContextField, CustomerContext } from "@uai/contracts";
import type { RequestScope } from "@uai/core";
import type { SourceGateway } from "@uai/connectors";

export class ContextAssembler {
  constructor(private readonly gateway: SourceGateway) {}

  async assemble(scope: RequestScope, fields: ContextField[], opts: { timeoutMs?: number } = {}): Promise<CustomerContext | undefined> {
    const customer = scope.caller.customer;
    if (!customer) return undefined;
    const { links, pseudoId } = customer;
    const missing: string[] = [];
    const ctx: CustomerContext = {
      tenantId: scope.tenant.id,
      customerId: pseudoId,
      identity: { linked: Object.keys(links), _src: scope.tenant.identity.mode === "cdp" ? "cdp" : "identity-map" },
      _meta: { computedAt: new Date().toISOString(), requested: fields, missing },
    };

    // 1. Consentement, vérifié côté serveur (S7).
    const consentId = links.consent ?? links.commerce;
    const consent = consentId ? await this.gateway.call(scope, "consent.read", { externalId: consentId }, opts) : undefined;
    if (consent?.ok && consent.value) {
      ctx.consent = consent.value;
      scope.consent = consent.value.personalization ? "granted" : "refused";
    } else {
      // Source de consentement muette : on ne personnalise pas (prudence).
      scope.consent = "unknown";
      missing.push("consent");
    }
    if (scope.consent !== "granted") {
      scope.addReason("R-CONSENT", "Personnalisation désactivée : consentement absent ou refusé.");
      return ctx;
    }

    // 2. Champs demandés, en parallèle, chacun dans son budget.
    const wants = (f: ContextField) => fields.includes(f);
    const [profile, loyalty, history] = await Promise.all([
      wants("profile") && links.commerce ? this.gateway.call(scope, "customer.profile.read", { externalId: links.commerce }, opts) : undefined,
      wants("loyalty") && links.loyalty ? this.gateway.call(scope, "loyalty.read", { externalId: links.loyalty }, opts) : undefined,
      wants("history") && links.orders ? this.gateway.call(scope, "orders.history.read", { externalId: links.orders }, opts) : undefined,
    ]);
    if (profile?.ok && profile.value) ctx.profile = profile.value;
    else if (wants("profile")) missing.push("profile");
    if (loyalty?.ok && loyalty.value) ctx.loyalty = loyalty.value;
    else if (wants("loyalty")) missing.push("loyalty");
    if (history?.ok && history.value) ctx.history = history.value;
    else if (wants("history")) missing.push("history");
    for (const m of missing) scope.addMissing(m);
    return ctx;
  }
}
