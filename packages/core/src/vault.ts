/**
 * Coffre de secrets, un espace par client (S6).
 *
 * Bouchon en mémoire : en production, un coffre réel (Vault, Secret Manager…)
 * avec une identité de service par client. Ici, un accès n'est possible qu'avec
 * l'identifiant du client courant : on ne peut pas lister les secrets d'un autre.
 */
import { randomBytes } from "node:crypto";

export class SecretVault {
  private readonly spaces = new Map<string, Map<string, string>>();

  set(tenantId: string, name: string, value: string): void {
    let space = this.spaces.get(tenantId);
    if (!space) {
      space = new Map();
      this.spaces.set(tenantId, space);
    }
    space.set(name, value);
  }

  get(tenantId: string, name: string): string {
    const value = this.spaces.get(tenantId)?.get(name);
    if (value === undefined) throw new Error(`secret absent pour ${tenantId}: ${name}`);
    return value;
  }

  /** Crée les secrets manquants (développement uniquement). */
  ensureDevSecrets(tenantIds: string[]): void {
    for (const id of tenantIds) {
      for (const name of ["session-signing", "identity-pepper", "cart-signing"]) {
        if (!this.spaces.get(id)?.has(name)) {
          this.set(id, name, process.env[`UAI_SECRET_${id.toUpperCase().replace(/-/g, "_")}_${name.toUpperCase().replace(/-/g, "_")}`] ?? randomBytes(32).toString("hex"));
        }
      }
    }
  }
}
