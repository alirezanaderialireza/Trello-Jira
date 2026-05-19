// apps/web/vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: [
      "src/**/__tests__/**/*.{test,spec}.{ts,tsx}",
      "src/**/*.{test,spec}.{ts,tsx}",
    ],
    exclude: ["node_modules", ".next"],
    reporters: ["verbose"],
  },
  resolve: {
    alias: {
      "@repo/domain": path.resolve(__dirname, "../../packages/domain/src/index.ts"),
    },
  },
});
