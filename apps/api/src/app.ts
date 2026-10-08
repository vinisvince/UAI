/**
 * API REST v1 + chat + routes de démonstration (DEMO_MODE).
 */
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ChatOrchestrator, MockLlm, UnavailableLlm, llmFromEnv, type LlmAdapter } from "@uai/chat";
import { ChatRequest, TOOL_CATALOG_V1, type ToolName } from "@uai/contracts";
import { UaiError, type Caller } from "@uai/core";
import { DEFAULT_SIMULATION, DEMO_PERSONAS, platformProducts } from "@uai/connectors";
import { createRuntime, toolsForLevel, type Runtime } from "@uai/engine";
import { z } from "zod";

/** Clés de démonstration (en clair uniquement ici ; la config ne stocke que leur empreinte). */
export const DEMO_KEYS: Record<string, { public: string; front: string; service: string }> = {
  celio: { public: "pk_celio_partner_demo", front: "fk_celio_site_demo", service: "sk_celio_sav_demo" },
  "maison-lune": { public: "pk_lune_partner_demo", front: "fk_lune_shop_demo", service: "sk_lune_sav_demo" },
};

export interface AppOptions {
  runtime?: Runtime;
  llm?: LlmAdapter;
  demoMode?: boolean;
  logger?: boolean;
}

const header = (req: FastifyRequest, name: string) => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

export function buildApp(opts: AppOptions = {}): { app: FastifyInstance; runtime: Runtime } {
  const runtime = opts.runtime ?? createRuntime();
  const demoMode = opts.demoMode ?? process.env.DEMO_MODE === "1";
  const llm = opts.llm ?? llmFromEnv();
  const chat = new ChatOrchestrator(runtime.executor, runtime.journal, llm);
  const app = Fastify({ logger: opts.logger ?? false });
  const state = { layerDown: false, llmMode: "normal" as "normal" | "down" | "hallucinate" };

  void app.register(cors, { origin: demoMode ? true : false });

  const authenticate = (req: FastifyRequest): Caller => {
    const auth = header(req, "authorization");
    return runtime.authenticate({
      apiKey: header(req, "x-api-key"),
      sessionToken: auth?.startsWith("Bearer ") ? auth.slice(7) : undefined,
      role: header(req, "x-uai-role"),
      motif: header(req, "x-uai-motif") ? decodeURIComponent(header(req, "x-uai-motif")!) : undefined,
    });
  };

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof UaiError) return reply.status(err.httpStatus).send(err.toJSON());
    if (err instanceof z.ZodError) {
      return reply.status(400).send({ error: "invalid_input", message: "Entrée invalide.", details: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: "invalid_input", message: (err as Error).message });
    app.log.error(err);
    return reply.status(503).send({ error: "unavailable", message: "Service temporairement indisponible." });
  });

  // Démo : simulation de la panne de toute la couche UA Intelligence.
  app.addHook("onRequest", async (req, reply) => {
    if (state.layerDown && req.url.startsWith("/v1/")) {
      return reply.status(503).send({ error: "unavailable", message: "UA Intelligence indisponible (simulation)." });
    }
  });

  app.get("/health", async () => ({ ok: true, version: "v1", tenants: runtime.tenants.list().length }));

  // ---------- API v1 ----------

  app.get("/v1/tools", async (req) => {
    const caller = authenticate(req);
    return {
      level: caller.level,
      tools: toolsForLevel(caller.level).map((n) => ({
        name: n,
        level: TOOL_CATALOG_V1[n].level,
        description: TOOL_CATALOG_V1[n].description,
        inputSchema: zodToJsonSchema(TOOL_CATALOG_V1[n].input, { target: "openApi3" }),
      })),
    };
  });

  app.post<{ Params: { name: string } }>("/v1/tools/:name", async (req) => {
    const caller = authenticate(req);
    return runtime.executor.execute(req.params.name, req.body, caller, "rest");
  });

  app.post("/v1/chat", async (req) => {
    const caller = authenticate(req);
    const body = ChatRequest.parse(req.body);
    const override = demoMode ? (state.llmMode === "down" ? new UnavailableLlm() : state.llmMode === "hallucinate" ? new MockLlm({ hallucinate: true }) : undefined) : undefined;
    return chat.turn(body, caller, override);
  });

  app.get("/v1/openapi.json", async () => openApiDocument());

  // ---------- Démonstration ----------

  if (demoMode) {
    app.get("/demo/tenants", async () =>
      runtime.tenants.list().map((t) => ({
        id: t.id,
        name: t.name,
        platform: t.platform,
        keys: DEMO_KEYS[t.id],
        personas: DEMO_PERSONAS[t.id] ?? [],
        connectors: runtime.registry.list(t.id).map((c) => ({ id: c.id, vendor: c.vendor, access: c.access, capabilities: c.capabilities() })),
        genUi: t.genUi.components,
      })),
    );

    /** Simule la connexion sur la plateforme (SLAS / Shopify) et précharge les sources lentes. */
    app.post("/demo/session", async (req) => {
      const caller = authenticate(req);
      if (caller.keyKind !== "front") throw new UaiError("forbidden", "Clé front requise.");
      const body = z.object({ externalId: z.string() }).strict().parse(req.body);
      const persona = (DEMO_PERSONAS[caller.tenant.id] ?? []).find((p) => p.externalId === body.externalId);
      if (!persona) throw new UaiError("not_found", "Persona inconnue.");
      const token = runtime.issueDemoSession(caller.tenant.id, body.externalId);
      const sessionCaller = runtime.authenticate({ apiKey: header(req, "x-api-key"), sessionToken: token });
      void runtime.executor.prefetch(sessionCaller).catch(() => undefined);
      return { token, customerRef: sessionCaller.customer?.pseudoId, label: persona.label };
    });

    /** Ce que le front lit directement chez la plateforme : prix et visuels. */
    app.get("/demo/platform/products", async (req) => {
      const caller = authenticate(req);
      return { products: platformProducts(caller.tenant.id) };
    });

    app.get("/demo/simulation", async () => ({
      connectors: runtime.sim.snapshot(),
      layerDown: state.layerDown,
      cacheDown: runtime.cacheStore.down,
      llmMode: state.llmMode,
      cache: runtime.cache.stats,
      calls: Object.fromEntries(runtime.sim.calls),
    }));

    app.post("/demo/simulation", async (req) => {
      const body = z
        .object({
          connector: z.string().optional(),
          down: z.boolean().optional(),
          slowFactor: z.number().min(0.1).max(20).optional(),
          layerDown: z.boolean().optional(),
          cacheDown: z.boolean().optional(),
          llmMode: z.enum(["normal", "down", "hallucinate"]).optional(),
          reset: z.boolean().optional(),
        })
        .strict()
        .parse(req.body);
      if (body.reset) {
        runtime.sim.reset(DEFAULT_SIMULATION);
        state.layerDown = false;
        state.llmMode = "normal";
        runtime.cacheStore.down = false;
      }
      if (body.connector) {
        runtime.sim.configure(body.connector, {
          ...(body.down !== undefined ? { down: body.down } : {}),
          ...(body.slowFactor !== undefined ? { slowFactor: body.slowFactor } : {}),
        });
      }
      if (body.layerDown !== undefined) state.layerDown = body.layerDown;
      if (body.cacheDown !== undefined) runtime.cacheStore.down = body.cacheDown;
      if (body.llmMode) state.llmMode = body.llmMode;
      return { ok: true };
    });

    app.get("/demo/journal", async (req) => {
      const caller = authenticate(req);
      return { entries: runtime.journal.list(caller.tenant.id, 40), integrity: runtime.journal.verify(caller.tenant.id) };
    });
  }

  return { app, runtime };
}

function openApiDocument() {
  const paths: Record<string, unknown> = {};
  for (const name of Object.keys(TOOL_CATALOG_V1) as ToolName[]) {
    const t = TOOL_CATALOG_V1[name];
    paths[`/v1/tools/${name}`] = {
      post: {
        summary: t.description,
        "x-uai-level": t.level,
        security: [{ apiKey: [] }, ...(t.level === "session" ? [{ apiKey: [], session: [] }] : [])],
        requestBody: { required: true, content: { "application/json": { schema: zodToJsonSchema(t.input, { target: "openApi3" }) } } },
        responses: {
          "200": { description: "Réponse justifiée (data, reasons, sources, partial, missing, ui)", content: { "application/json": { schema: zodToJsonSchema(t.output, { target: "openApi3" }) } } },
          "400": { description: "Entrée invalide" },
          "401": { description: "Clé ou session invalide" },
          "403": { description: "Niveau d'accès insuffisant" },
          "429": { description: "Quota dépassé" },
        },
      },
    };
  }
  return {
    openapi: "3.0.3",
    info: { title: "UA Intelligence API", version: "v1", description: "Outils commerce exposés en REST. Mêmes contrats que le serveur MCP." },
    components: {
      securitySchemes: {
        apiKey: { type: "apiKey", in: "header", name: "x-api-key" },
        session: { type: "http", scheme: "bearer", description: "Jeton de session acheteur émis par la plateforme" },
      },
    },
    paths,
  };
}
