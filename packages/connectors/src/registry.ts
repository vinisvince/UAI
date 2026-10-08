/**
 * Registre des connecteurs : une instance par client (accès sources cloisonnés)
 * et résolution par capacité, dans l'ordre déclaré dans la configuration.
 */
import type { Capability, Connector } from "@uai/contracts";
import type { TenantConfig } from "@uai/core";
import type { SimulationControl } from "./simulation.js";
import {
  AlgoliaConnector,
  CelioCmpConnector,
  EinsteinConnector,
  LoyaltyConnector,
  OciConnector,
  OmsMulesoftConnector,
  ScapiConnector,
  SfmcRestockConnector,
  TrueFitConnector,
} from "./sfcc/index.js";
import {
  LuneRestockAppConnector,
  ShopifyAdminConnector,
  ShopifyPrivacyConnector,
  ShopifyRecoConnector,
  ShopifyStorefrontConnector,
} from "./shopify/index.js";

export type ConnectorFactory = (sim: SimulationControl) => Connector;

export const CONNECTOR_FACTORIES: Record<string, ConnectorFactory> = {
  "sfcc-scapi": (s) => new ScapiConnector(s),
  "algolia-mcp": (s) => new AlgoliaConnector(s),
  "sfcc-oci": (s) => new OciConnector(s),
  "sf-loyalty": (s) => new LoyaltyConnector(s),
  "sf-oms-mulesoft": (s) => new OmsMulesoftConnector(s),
  "einstein-reco": (s) => new EinsteinConnector(s),
  "truefit-mcp": (s) => new TrueFitConnector(s),
  "celio-cmp": (s) => new CelioCmpConnector(s),
  "sfmc-restock": (s) => new SfmcRestockConnector(s),
  "shopify-storefront": (s) => new ShopifyStorefrontConnector(s),
  "shopify-admin": (s) => new ShopifyAdminConnector(s),
  "shopify-reco": (s) => new ShopifyRecoConnector(s),
  "shopify-privacy": (s) => new ShopifyPrivacyConnector(s),
  "lune-restock-app": (s) => new LuneRestockAppConnector(s),
};

export class ConnectorRegistry {
  private readonly byTenant = new Map<string, Connector[]>();

  constructor(tenants: TenantConfig[], sim: SimulationControl, factories = CONNECTOR_FACTORIES) {
    for (const t of tenants) {
      this.byTenant.set(
        t.id,
        t.connectors.map((id) => {
          const factory = factories[id];
          if (!factory) throw new Error(`connecteur inconnu pour ${t.id} : ${id}`);
          return factory(sim);
        }),
      );
    }
  }

  list(tenantId: string): Connector[] {
    return this.byTenant.get(tenantId) ?? [];
  }

  /** Premier connecteur du client qui fournit la capacité (ordre de préférence de la config). */
  forCapability(tenantId: string, capability: Capability): Connector | undefined {
    return this.list(tenantId).find((c) => c.capabilities().includes(capability));
  }

  get(tenantId: string, connectorId: string): Connector | undefined {
    return this.list(tenantId).find((c) => c.id === connectorId);
  }
}
