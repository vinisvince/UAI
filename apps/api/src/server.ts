import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 8787);
const { app } = buildApp({ demoMode: process.env.DEMO_MODE !== "0", logger: process.env.LOG === "1" });

// Hébergement (Render…) : l'API sert aussi la démo construite (`pnpm build:demo`), sur la même origine.
const demoDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../demo/dist");
if (process.env.SERVE_DEMO === "1" && existsSync(demoDir)) {
  void app.register(fastifyStatic, { root: demoDir });
}

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => console.log(`UA Intelligence API sur http://localhost:${port} (démo ${process.env.DEMO_MODE !== "0" ? "activée" : "désactivée"})`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
