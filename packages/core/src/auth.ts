/**
 * Résolution de l'appelant : client, niveau d'accès, acheteur.
 *
 * Règles (S1, S2, S3) :
 * - le client vient de la clé d'API, jamais du corps de la requête ;
 * - l'acheteur vient du jeton de session vérifié, jamais d'un argument d'outil ;
 * - le niveau "interne" exige un rôle autorisé et un motif, journalisés.
 */
import type { AccessLevel } from "@uai/contracts";
import { UaiError } from "./errors.js";
import type { IdentityMap, IdentityLinks } from "./identity.js";
import { verifySessionToken } from "./session.js";
import type { TenantConfig, TenantRegistry } from "./tenant.js";
import type { SecretVault } from "./vault.js";

export interface Caller {
  tenant: TenantConfig;
  level: AccessLevel;
  keyLabel: string;
  keyKind: "public" | "front" | "service";
  role?: string;
  motif?: string;
  customer?: { pseudoId: string; links: IdentityLinks };
}

export interface Credentials {
  apiKey?: string;
  sessionToken?: string;
  role?: string;
  motif?: string;
}

export interface AuthDeps {
  tenants: TenantRegistry;
  vault: SecretVault;
  identity: IdentityMap;
}

export function resolveCaller(creds: Credentials, deps: AuthDeps, now = Date.now()): Caller {
  if (!creds.apiKey) throw new UaiError("unauthorized", "Clé d'API manquante.");
  const hit = deps.tenants.resolveKey(creds.apiKey);
  if (!hit) throw new UaiError("unauthorized", "Clé d'API inconnue.");
  const { tenant, key } = hit;
  const base = { tenant, keyLabel: key.label, keyKind: key.kind } as const;

  switch (key.kind) {
    case "public":
      if (creds.sessionToken) {
        throw new UaiError("forbidden", "Le niveau Délégué (agent agissant pour un client) n'est pas ouvert.");
      }
      return { ...base, level: "public" };

    case "front": {
      if (!creds.sessionToken) return { ...base, level: "public" };
      const check = verifySessionToken(deps.vault.get(tenant.id, "session-signing"), creds.sessionToken, tenant.id, now);
      if (!check.ok) throw new UaiError("unauthorized", `Session acheteur invalide (${check.reason}).`);
      const customer = deps.identity.resolve(tenant.id, check.payload.sub);
      return { ...base, level: "session", customer };
    }

    case "service": {
      if (!creds.role || !key.roles.includes(creds.role)) {
        throw new UaiError("forbidden", "Rôle absent ou non autorisé pour cette clé.");
      }
      if (!creds.motif || creds.motif.trim().length < 3) {
        throw new UaiError("forbidden", "Motif de consultation obligatoire au niveau Interne.");
      }
      return { ...base, level: "interne", role: creds.role, motif: creds.motif.trim().slice(0, 200) };
    }
  }
}
