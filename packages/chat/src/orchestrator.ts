/**
 * Chat Gen UI gouverné.
 *
 * Garde-fous :
 * - S1 : le chat n'expose que les outils publics et session ; l'acheteur vient
 *   de la session, jamais des arguments proposés par le modèle ;
 * - S5 : le bloc UI est validé contre le catalogue ET contre les identifiants
 *   renvoyés par les outils du tour ; sinon, réponse texte ;
 * - zéro donnée générée : un texte qui contient un prix ou une quantité est neutralisé ;
 * - D7 : si le fournisseur LLM tombe, mode dégradé par règles d'intention.
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  TOOL_CATALOG_V1,
  levelAllows,
  validateUiBlock,
  type ChatRequest,
  type ChatResponse,
  type Reason,
  type SourceRef,
  type ToolName,
  type UiBlock,
} from "@uai/contracts";
import { UaiError, type Caller, type Journal } from "@uai/core";
import { uiIdsFrom, type ToolExecutor } from "@uai/engine";
import { MockLlm, type Composition, type LlmAdapter, type Plan, type ToolResultForModel, type ToolSpec } from "./llm.js";

const CHAT_TOOLS = (Object.keys(TOOL_CATALOG_V1) as ToolName[]).filter((n) => TOOL_CATALOG_V1[n].level !== "interne");
const MAX_CALLS = 3;
const FACT_PATTERN = /(\d+[.,]?\d*\s?(€|eur\b|euros?))|(\b\d+\s+(pièces?|articles?|exemplaires?|en stock)\b)/i;

export class ChatOrchestrator {
  constructor(
    private readonly executor: ToolExecutor,
    private readonly journal: Journal,
    private readonly llm: LlmAdapter,
    private readonly fallback: LlmAdapter = new MockLlm(),
  ) {}

  toolSpecs(caller: Caller): ToolSpec[] {
    return CHAT_TOOLS.filter((n) => levelAllows(caller.level, TOOL_CATALOG_V1[n].level)).map((n) => ({
      name: n,
      description: TOOL_CATALOG_V1[n].description,
      inputSchema: zodToJsonSchema(TOOL_CATALOG_V1[n].input, { target: "openApi3" }),
    }));
  }

  async turn(req: ChatRequest, caller: Caller, llmOverride?: LlmAdapter): Promise<ChatResponse> {
    if (caller.level === "interne") throw new UaiError("forbidden", "Le chat est réservé au site, à l'app et aux acheteurs.");
    const started = performance.now();
    const llm = llmOverride ?? this.llm;
    let degraded = false;
    let provider = llm.name;
    const reasons: Reason[] = [];
    const sources = new Map<string, SourceRef>();
    const tools = this.toolSpecs(caller);

    let plan: Plan;
    try {
      plan = await llm.plan({ message: req.message, page: req.page, tools, signedIn: caller.level === "session" });
    } catch {
      degraded = true;
      provider = `${this.fallback.name} (repli)`;
      reasons.push({ rule: "R-CHAT-DEGRADED", text: "Fournisseur LLM indisponible : réponse par règles d'intention." });
      plan = await this.fallback.plan({ message: req.message, page: req.page, tools, signedIn: caller.level === "session" });
    }

    const results: ToolResultForModel[] = [];
    const toolCalls: ChatResponse["toolCalls"] = [];
    for (const call of plan.calls.slice(0, MAX_CALLS)) {
      const spec = (TOOL_CATALOG_V1 as Record<string, { level: string } | undefined>)[call.name];
      if (!spec || spec.level === "interne") {
        reasons.push({ rule: "R-CHAT-GUARD", text: `Appel refusé : l'outil « ${call.name} » n'est pas exposé au chat.` });
        results.push({ tool: call.name, ok: false, error: "outil non autorisé dans le chat" });
        toolCalls.push({ tool: call.name, ok: false, partial: false });
        continue;
      }
      if (spec.level === "session" && caller.level !== "session") {
        results.push({ tool: call.name, ok: false, error: "session acheteur requise" });
        toolCalls.push({ tool: call.name, ok: false, partial: false });
        continue;
      }
      try {
        const r = await this.executor.execute(call.name, call.args, caller, "chat");
        results.push({ tool: call.name, ok: true, data: r.data, suggestedUi: r.ui ?? undefined });
        toolCalls.push({ tool: call.name, ok: true, partial: r.partial });
        r.reasons.forEach((x) => reasons.push(x));
        r.sources.forEach((s) => sources.set(s.connector, s));
      } catch (e) {
        const msg = e instanceof UaiError ? e.message : "erreur";
        results.push({ tool: call.name, ok: false, error: msg });
        toolCalls.push({ tool: call.name, ok: false, partial: false });
      }
    }

    let composition: Composition;
    if (!plan.calls.length) {
      composition = { text: plan.text ?? "Comment puis-je vous aider ?" };
    } else {
      try {
        composition = await llm.compose({ message: req.message, results, components: caller.tenant.genUi.components });
      } catch {
        degraded = true;
        provider = `${this.fallback.name} (repli)`;
        composition = await this.fallback.compose({ message: req.message, results, components: caller.tenant.genUi.components });
      }
    }

    // Validation du bloc UI : structure, catalogue du client, identifiants du tour (S5).
    let ui: UiBlock | null = null;
    let uiRejected: string[] | undefined;
    if (composition.ui !== undefined && composition.ui !== null) {
      const okData = results.filter((r) => r.ok).map((r) => ({ data: r.data, ui: null }));
      const check = validateUiBlock(composition.ui, caller.tenant.genUi.components, uiIdsFrom(okData));
      if (check.ok) ui = check.block;
      else {
        uiRejected = check.errors;
        reasons.push({ rule: "R-GENUI-REJECT", text: "Bloc d'interface proposé par le modèle refusé : réponse en texte." });
      }
    }

    // Zéro donnée factuelle produite par le modèle.
    let text = composition.text.trim().slice(0, 400) || "Voici les informations demandées.";
    if (FACT_PATTERN.test(text)) {
      text = "Voici les informations demandées.";
      reasons.push({ rule: "R-CHAT-TEXT-GUARD", text: "Texte du modèle neutralisé : il contenait un prix ou une quantité." });
    }

    const cart = results.find((r) => r.ok && r.tool === "prepare_cart")?.data as { url?: string } | undefined;
    const links = cart?.url ? [{ label: "Valider mon panier", url: cart.url }] : [];

    this.journal.append({
      requestId: `chat-${Date.now().toString(36)}`,
      tenantId: caller.tenant.id,
      caller: { level: caller.level, keyLabel: caller.keyLabel },
      channel: "chat",
      tool: "chat",
      ...(caller.customer ? { customerRef: caller.customer.pseudoId } : {}),
      consent: "not_required",
      connectorsRead: [...sources.keys()],
      rulesVersion: caller.tenant.version,
      partial: toolCalls.some((t) => t.partial),
      outcome: "ok",
      durationMs: Math.round(performance.now() - started),
      aiGenerated: true,
    });

    return {
      text,
      ui,
      aiGenerated: true,
      toolCalls,
      reasons,
      sources: [...sources.values()],
      links,
      ...(uiRejected ? { uiRejected } : {}),
      degraded,
      provider,
    };
  }
}
