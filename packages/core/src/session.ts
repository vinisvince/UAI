/**
 * Jeton de session acheteur (niveau "session", S1/S2).
 *
 * En production, le front transmet le jeton émis par la plateforme (SLAS pour
 * SFCC, customer access token pour Shopify) et le connecteur le vérifie auprès
 * d'elle. Le bouchon simule cette vérification avec un jeton signé HMAC par
 * client. Le `customerId` ne vient JAMAIS d'un argument d'outil.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const SessionPayload = z.object({
  tid: z.string(), // client
  sub: z.string(), // identifiant acheteur sur la plateforme commerce
  exp: z.number().int(), // epoch secondes
});
export type SessionPayload = z.infer<typeof SessionPayload>;

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("base64url");

export function issueSessionToken(secret: string, payload: SessionPayload): string {
  const body = b64(JSON.stringify(payload));
  return `${body}.${sign(secret, body)}`;
}

export type SessionCheck =
  | { ok: true; payload: SessionPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "wrong_tenant" };

export function verifySessionToken(secret: string, token: string, expectedTenant: string, now = Date.now()): SessionCheck {
  const [body, sig] = token.split(".");
  if (!body || !sig) return { ok: false, reason: "malformed" };
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "bad_signature" };
  let payload: SessionPayload;
  try {
    payload = SessionPayload.parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (payload.tid !== expectedTenant) return { ok: false, reason: "wrong_tenant" };
  if (payload.exp * 1000 < now) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}
