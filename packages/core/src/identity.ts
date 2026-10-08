/**
 * Correspondance d'identifiants pseudonymisés (couche 3, stockage n°2).
 *
 * L'identifiant exposé est un pseudonyme HMAC propre au client. La table relie
 * ce pseudonyme aux identifiants des systèmes sources. Elle reste une donnée
 * personnelle : purge propagée lors d'un effacement (S9).
 * Mode "cdp" : le CDP du client résout l'identité, la table n'est pas utilisée.
 */
import { createHmac } from "node:crypto";
import type { SecretVault } from "./vault.js";

export type SystemName = "commerce" | "loyalty" | "orders" | "consent";
export type IdentityLinks = Partial<Record<SystemName, string>>;

export class IdentityMap {
  private readonly tables = new Map<string, Map<string, IdentityLinks>>();

  constructor(private readonly vault: SecretVault) {}

  pseudonymize(tenantId: string, commerceId: string): string {
    const pepper = this.vault.get(tenantId, "identity-pepper");
    return "c_" + createHmac("sha256", pepper).update(`${tenantId}|${commerceId}`).digest("hex").slice(0, 20);
  }

  private table(tenantId: string): Map<string, IdentityLinks> {
    let t = this.tables.get(tenantId);
    if (!t) {
      t = new Map();
      this.tables.set(tenantId, t);
    }
    return t;
  }

  /** Règle de rapprochement explicite : l'identifiant commerce est la clé pivot. */
  link(tenantId: string, commerceId: string, links: IdentityLinks): string {
    const pseudo = this.pseudonymize(tenantId, commerceId);
    this.table(tenantId).set(pseudo, { ...links, commerce: commerceId });
    return pseudo;
  }

  /** Résolution depuis la session : sans lien connu, seul le système commerce est rattaché. */
  resolve(tenantId: string, commerceId: string): { pseudoId: string; links: IdentityLinks } {
    const pseudoId = this.pseudonymize(tenantId, commerceId);
    return { pseudoId, links: this.table(tenantId).get(pseudoId) ?? { commerce: commerceId } };
  }

  get(tenantId: string, pseudoId: string): IdentityLinks | undefined {
    return this.table(tenantId).get(pseudoId);
  }

  /** Droit à l'effacement : supprime la ligne du client. */
  purge(tenantId: string, pseudoId: string): boolean {
    return this.table(tenantId).delete(pseudoId);
  }

  size(tenantId: string): number {
    return this.table(tenantId).size;
  }
}
