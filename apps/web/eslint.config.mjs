// apps/web/eslint.config.mjs
// ─────────────────────────────────────────────────────────────────────────────
// ESLint Flat Config (ESLint v9 / Next 15+)
//
// Two architectural guards live here:
//
//   1. Date Engine Boundary (existing, kept):
//      Direct imports of dayjs / jalaliday / dayjs/plugin/* are forbidden.
//      Everything goes through `@/lib/date`.
//
//   2. Architecture Boundaries (NEW — Phase 0.2 / checklist 0.6):
//      Uses `eslint-plugin-boundaries` to declare layers and forbidden
//      cross-layer imports. The intent (matching the master architecture
//      doctrine):
//
//        app, feature  →  cannot import @repo/db / @repo/domain directly.
//                         They go through @repo/api (the public boundary).
//        feature       →  cannot reach into another feature's internals.
//                         Cross-feature talk happens via shared, app, or api.
//        domain        →  cannot import infrastructure or db.
//                         (Enforced as `@repo/db` import block here, since
//                          the package itself is outside this lint root.)
//        infrastructure→  may import db; cannot import features/app.
//
//      This catches the most common drift early without micromanaging every
//      module. Tighter rules can be added per-feature later.
// ─────────────────────────────────────────────────────────────────────────────

import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

// =============================================================================
// Architecture element definitions
// =============================================================================
// These map file paths to architectural roles. `boundaries/elements` uses these
// to evaluate cross-layer imports. The ordering matters — earlier patterns win.

const boundaryElements = [
  // tests are exempt
  {
    type: "test",
    pattern: ["src/**/*.{test,spec}.{ts,tsx}", "src/**/__tests__/**"],
    mode: "file",
  },
  // Auth bridge — talks to @repo/db (it must, to read users/workspace tables).
  {
    type: "auth-bridge",
    pattern: "src/auth/*",
    mode: "file",
  },
  // Next.js App Router pages, API routes, layouts, error pages.
  {
    type: "app",
    pattern: "src/app/**",
    mode: "folder",
  },
  // Feature slices: src/features/<name>/**
  // capture[0] = feature name, used for cross-feature isolation rules.
  {
    type: "feature",
    pattern: "src/features/*/**",
    mode: "folder",
    capture: ["feature"],
  },
  // Browser-side infra: observability, platform shims, etc.
  {
    type: "infrastructure",
    pattern: "src/infrastructure/**",
    mode: "folder",
  },
  // Cross-cutting shared modules.
  {
    type: "shared",
    pattern: [
      "src/components/**",
      "src/lib/**",
      "src/providers/**",
      "src/utils/**",
    ],
    mode: "folder",
  },
];

// =============================================================================
// Element-to-element rules
// =============================================================================
// Each rule says: "elements of type X are allowed to import elements of types
// listed under `allow`. Anything else is denied (when default policy is `disallow`)."

const boundaryRules = [
  // app may import everything except feature internals it doesn't own.
  // Importing a feature's public surface (its top-level files) IS allowed.
  { from: ["app"],            allow: ["app", "feature", "infrastructure", "shared", "auth-bridge"] },
  // a feature may import shared utilities, infrastructure, and the auth bridge.
  // It MAY import its OWN feature folder (matched by capture below).
  // Cross-feature imports are blocked — features should not become coupled
  // by reaching into each other's stores or components.
  {
    from: [["feature", { feature: "*" }]],
    allow: [
      ["feature", { feature: "${from.feature}" }],
      "shared",
      "infrastructure",
      "auth-bridge",
    ],
  },
  // shared can only depend on shared. Anything else creates a cycle risk.
  { from: ["shared"],         allow: ["shared"] },
  // infrastructure can depend on shared. It may NOT reach into features.
  { from: ["infrastructure"], allow: ["infrastructure", "shared"] },
  // auth-bridge has its own narrow surface — it may use shared and may be
  // imported anywhere. We don't restrict its outgoing imports because it
  // legitimately needs @repo/db / @repo/auth.
  { from: ["auth-bridge"],    allow: ["auth-bridge", "shared"] },
];

// =============================================================================
// Final config
// =============================================================================

const config = [
  // 1. Ignore auto-generated and vendor folders.
  {
    ignores: [
      ".next/**",
      "dist/**",
      "node_modules/**",
      "eslint.config.mjs",
    ],
  },

  // 2. Inherit Next.js core rules.
  ...compat.extends("next/core-web-vitals"),

  // 3. Date Engine Boundary — prevents direct dayjs/jalaliday imports.
  //    (whitelist for date.ts/date.test.ts is below)
  {
    files: ["src/**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "dayjs",            message: "✗ Import from '@/lib/date' instead." },
            { name: "jalaliday",        message: "✗ Import from '@/lib/date' instead." },
            { name: "jalaliday/dayjs",  message: "✗ Import from '@/lib/date' instead." },
            { name: "jalaliday/intl",   message: "✗ Import from '@/lib/date' instead." },
          ],
          patterns: [
            { group: ["dayjs/plugin/*"], message: "✗ All plugins are registered in '@/lib/date'." },
          ],
        },
      ],
    },
  },

  // 4. Whitelist: only date.ts and date.test.ts may import dayjs.
  {
    files: ["src/lib/date.ts", "src/lib/date.test.ts"],
    rules: { "no-restricted-imports": "off" },
  },

  // 5. Architecture Boundary Linter — enforce layered architecture.
  {
    files: ["src/**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    plugins: { boundaries },
    settings: {
      "boundaries/elements": boundaryElements,
      "boundaries/include": ["src/**/*"],
      "boundaries/ignore": [
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/**/__tests__/**",
      ],
    },
    rules: {
      "boundaries/element-types": [
        // Phase 0.6 follow-up — promoted from "warn" to "error" after the
        // 16 historic infrastructure → feature violations were resolved by
        // moving the shared utilities (telemetry / debugStore / canonical
        // serializer) into `src/lib/` and making `OfflineSyncManager`
        // generic in its persisted-state type. Architecture violations now
        // block merges instead of accumulating silently.
        "error",
        {
          default: "disallow",
          rules: boundaryRules,
        },
      ],
    },
  },

  // 6. Forbid the riskiest cross-layer imports inside the client app.
  //    Server actions and the auth bridge legitimately need @repo/db, so
  //    this rule fires only in features and shared (UI) code.
  //
  //    `allowTypeImports: true` follows the master architecture rule
  //    "Type-Only Exception": `import type { Card } from "@repo/domain"`
  //    is allowed, because Drizzle / domain TYPES are erased at compile
  //    time and carry no runtime coupling. Only runtime imports
  //    (functions, classes) are blocked.
  //
  //    `@repo/domain/ordering` is exempt — the LexoRank primitives
  //    (generatePosition, comparePositions, shouldRebalancePosition,
  //    PositionCollisionError) are pure, deterministic functions used
  //    by the optimistic-positioning engine in features. They are
  //    domain-shaped but architecturally a *shared utility*, exposed
  //    as its own package subpath in `@repo/domain` so the carveout
  //    is explicit at the import-site rather than implicit.
  {
    files: ["src/features/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            // Layer-jumping prevention for client code:
            {
              name: "@repo/db",
              message:
                "✗ UI/feature code must not import @repo/db at runtime. Use a server action or a tRPC route.",
              allowTypeImports: true,
            },
            {
              name: "@repo/domain",
              message:
                "✗ UI/feature code must not import domain handlers at runtime. Use a server action.",
              allowTypeImports: true,
            },
          ],
          patterns: [
            {
              group: ["@repo/db/*"],
              message:
                "✗ UI/feature code must not import @repo/db at runtime. Use a server action or a tRPC route.",
              allowTypeImports: true,
            },
            {
              // Blocks domain subpaths EXCEPT the LexoRank primitives,
              // which are pure functions safe to call from the client.
              group: ["@repo/domain/*", "!@repo/domain/ordering"],
              message:
                "✗ UI/feature code must not import domain handlers at runtime. Use a server action. (LexoRank primitives are exempt — import from '@repo/domain/ordering'.)",
              allowTypeImports: true,
            },
            // Keep the date engine boundary alive in this scope too — these
            // are pure runtime imports, no type-only carve-out needed.
            { group: ["dayjs/plugin/*"], message: "✗ All plugins are registered in '@/lib/date'." },
          ],
        },
      ],
    },
  },
];

export default config;
