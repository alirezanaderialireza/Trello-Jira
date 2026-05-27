// packages/api/vitest.config.ts
//
// Mirrors the apps/web setup: globals, node environment, src-only test
// glob. Tests live next to source under __tests__/ and use the
// .test.ts suffix.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
