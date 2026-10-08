import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 8787);
const { app } = buildApp({ demoMode: process.env.DEMO_MODE !== "0", logger: process.env.LOG === "1" });

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => console.log(`UA Intelligence API sur http://localhost:${port} (démo ${process.env.DEMO_MODE !== "0" ? "activée" : "désactivée"})`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
