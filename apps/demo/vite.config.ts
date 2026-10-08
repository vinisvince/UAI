import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const api = process.env.UAI_API_URL ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/v1": api,
      "/demo": api,
      "/health": api,
    },
  },
});
