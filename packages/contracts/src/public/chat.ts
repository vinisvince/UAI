/**
 * Contrat public du chat Gen UI.
 */
import { z } from "zod";
import { UiBlock } from "../genui.js";
import { Reason, SourceRef } from "./v1.js";

export const ChatRequest = z
  .object({
    message: z.string().min(1).max(500),
    /** Contexte de page fourni par le front (produit consulté), jamais l'identité du client. */
    page: z.object({ productId: z.string().max(64).optional() }).strict().optional(),
  })
  .strict();
export type ChatRequest = z.infer<typeof ChatRequest>;

export const ChatResponse = z.object({
  text: z.string(),
  ui: UiBlock.nullable(),
  /** AI Act, article 50 : la réponse est signalée comme générée par une IA. */
  aiGenerated: z.literal(true),
  toolCalls: z.array(z.object({ tool: z.string(), ok: z.boolean(), partial: z.boolean() })),
  reasons: z.array(Reason),
  sources: z.array(SourceRef),
  /** Liens d'action issus des outils (jamais écrits par le modèle), ex. panier signé. */
  links: z.array(z.object({ label: z.string(), url: z.string() })),
  /** Si le bloc proposé par le modèle est invalide, il est remplacé par du texte. */
  uiRejected: z.array(z.string()).optional(),
  degraded: z.boolean(),
  provider: z.string(),
});
export type ChatResponse = z.infer<typeof ChatResponse>;
