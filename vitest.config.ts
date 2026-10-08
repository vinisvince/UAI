import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/api/test/**/*.test.ts", "apps/mcp/test/**/*.test.ts"],
    environment: "node",
    testTimeout: 15000,
  },
});
