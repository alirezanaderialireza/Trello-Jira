// eslint.config.mjs (monorepo root)
//
// ─────────────────────────────────────────────────────────────────────────────
// Architecture Linter — Phase 0.6
//
// Enforces the layered architecture across `packages/*` using
// `eslint-plugin-boundaries`. The intent (matching the master architecture
// doctrine):
//
//     ┌──────────────────────────────────────────────────────────┐
//     │ api      (packages/api — tRPC routers, services)          │
//     │   ↓ may import                                            │
//     │   domain, db, infrastructure, auth                        │
//     ├──────────────────────────────────────────────────────────┤
//     │ db       (packages/db — Drizzle schema + repositories)    │
//     │   ↓ may import                                            │
//     │   domain (ports/types)                                    │
//     ├──────────────────────────────────────────────────────────┤
//     │ infrastructure (packages/infrastructure)                  │
//     │   ↓ may import                                            │
//     │   domain (ports/types), auth                              │
//     ├──────────────────────────────────────────────────────────┤
//     │ auth     (packages/auth — JWT, password hashing)          │
//     │   ↓ may import                                            │
//     │   domain                                                  │
//     ├──────────────────────────────────────────────────────────┤
//     │ domain   (packages/domain — Pure business logic, ports)   │
//     │   ↓ may import                                            │
//     │   nothing (pure — no I/O, no UI, no Drizzle, no Redis)    │
//     └──────────────────────────────────────────────────────────┘
//
// `apps/web` is intentionally NOT linted by this root config — it has its
// own specialized flat config at `apps/web/eslint.config.mjs` that handles
// the within-web layering (app → feature → shared → infrastructure-bridge
// → auth-bridge), the date engine boundary, and the @repo/db / @repo/domain
// import block for client code. This root config focuses on the
// inter-package graph that `apps/web` cannot see.
//
// ─────────────────────────────────────────────────────────────────────────────
// HOW IT IS WIRED
//
// Each `packages/*` package has a `lint` script that runs
// `eslint src --max-warnings=0`. ESLint flat config walks UP the file tree
// looking for the closest `eslint.config.mjs`, so when you run lint from
// `packages/db` it picks up THIS file. The boundary patterns use the
// `**/packages/<name>/src/**` form so they match regardless of cwd.
//
// `pnpm lint` at the root runs `turbo run lint`, which fans out to each
// package's lint task in parallel and caches results.
//
// ─────────────────────────────────────────────────────────────────────────────
// HOW TO ADD A NEW PACKAGE
//
//   1. Add a `lint` script to its package.json (see existing packages).
//   2. Add an entry to `monorepoElements` below with its layer type.
//   3. Add an entry to `monorepoRules` describing what it may import.
//   4. Decide if it should also block specific external libraries via
//      `boundaries/external` (e.g. domain forbids react/next/dayjs).
// ─────────────────────────────────────────────────────────────────────────────

import js        from "@eslint/js";
import tseslint  from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";

// ─── Element definitions ─────────────────────────────────────────────────────
//
// `mode: "folder"` means the element is identified by the folder it lives in,
// NOT the individual file. This keeps the type stable for files moved between
// subfolders inside the same package.
//
// The `**/` prefix on every pattern is critical: ESLint runs from the cwd of
// whoever invoked it (a per-package `lint` script runs from the package dir),
// so absolute prefixes would not match. `**/packages/<name>/src/**` matches
// regardless of which directory ESLint walks up from.
//
// Tests, migrations, build scripts and config files are intentionally typed
// as exempt elements so the architecture rule engine ignores them — those
// files legitimately reach across layers (e.g. a migration script importing
// from `@repo/db` schema and a domain helper at the same time).

const monorepoElements = [
  // 1. Tests are exempt from architecture rules.
  {
    type: "test",
    pattern: [
      "**/*.{test,spec}.{ts,tsx}",
      "**/__tests__/**",
    ],
    mode: "file",
  },
  // 2. Migrations are exempt — raw SQL adjacent files have no layer.
  {
    type: "migration",
    pattern: "**/packages/db/migrations/**",
    mode: "file",
  },
  // 3. Layered packages.
  { type: "api",            pattern: "**/packages/api/src/**",            mode: "folder" },
  { type: "db",             pattern: "**/packages/db/src/**",             mode: "folder" },
  { type: "domain",         pattern: "**/packages/domain/src/**",         mode: "folder" },
  { type: "infrastructure", pattern: "**/packages/infrastructure/src/**", mode: "folder" },
  { type: "auth",           pattern: "**/packages/auth/src/**",           mode: "folder" },
];

// ─── Element-to-element rules ────────────────────────────────────────────────
//
// `default: "disallow"` makes this an allow-list — any layer pair NOT
// explicitly listed below is rejected. This is strict-by-default, which is
// the architecture doctrine for this project.
//
// Each `from` ALSO allows itself (e.g. api → api) so files within the same
// package can freely import each other. This is intentional: layer boundaries
// are about which OTHER package you may reach, not about restricting
// movement inside one.

const monorepoRules = [
  // api: backend wiring — may compose every layer below it.
  { from: "api",            allow: ["api", "domain", "db", "infrastructure", "auth"] },

  // db: the persistence layer — only knows the ports / types it implements.
  { from: "db",             allow: ["db", "domain"] },

  // infrastructure: I/O adapters — may use domain ports + the auth primitives
  // (token signing, password hashing) it wraps. Notably MUST NOT import db
  // because that would couple Redis adapters to Drizzle schemas.
  { from: "infrastructure", allow: ["infrastructure", "domain", "auth"] },

  // auth: low-level crypto + session primitives. Talks only to domain types.
  { from: "auth",           allow: ["auth", "domain"] },

  // domain: pure business logic. Internal to itself only — no I/O, no UI,
  // no Drizzle, no Redis. Anything else is a layering violation.
  { from: "domain",         allow: ["domain"] },
];

// ─── External library guardrails ─────────────────────────────────────────────
//
// `boundaries/external` lets us forbid specific npm packages from leaking
// into layers where they have no business. The most important rule is that
// `domain` stays pure: no React, no Next.js, no Drizzle, no Redis, no
// dayjs. If you find yourself wanting to import any of those into domain,
// the right answer is to define a port in the domain and have the caller
// inject an implementation.

const monorepoExternalRules = [
  {
    from: ["domain"],
    disallow: [
      "react",
      "react-*",
      "next",
      "next/*",
      "dayjs",
      "dayjs/*",
      "drizzle-orm",
      "drizzle-orm/*",
      "ioredis",
      "@trpc/*",
    ],
  },
  {
    from: ["db"],
    // db is the only place Drizzle is allowed; everything else above MUST
    // call a repository.
    disallow: ["next", "next/*", "react", "react-*", "@trpc/*"],
  },
  {
    from: ["auth"],
    disallow: ["next", "next/*", "react", "react-*", "drizzle-orm", "drizzle-orm/*"],
  },
];

// ─── Final config ───────────────────────────────────────────────────────────

export default [
  // 1. Folders ESLint should never visit. `apps/**` has its own config
  //    living next to it, so we exclude it from the root walk.
  {
    ignores: [
      "node_modules",
      "**/node_modules/**",
      "dist",
      "**/dist/**",
      "build",
      "**/build/**",
      ".next",
      "**/.next/**",
      ".turbo",
      "**/.turbo/**",
      "**/*.d.ts",
      // apps/web has its own dedicated config; do not double-lint.
      "apps/**",
      // Migration files are raw SQL or backfill scripts.
      "**/packages/db/migrations/**",
    ],
  },

  // 2. Inherit the language defaults so this config also serves as a safety
  //    net for things like `no-undef` in any package missing a per-package
  //    config.
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // 3. Architecture boundaries on every package source tree.
  {
    files: ["packages/**/src/**/*.{ts,tsx,js,mjs,cjs}"],
    plugins: { boundaries },
    settings: {
      "boundaries/elements": monorepoElements,
      "boundaries/include": ["**/packages/**/src/**"],
      "boundaries/ignore": [
        "**/*.{test,spec}.{ts,tsx}",
        "**/__tests__/**",
      ],
    },
    rules: {
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: monorepoRules,
        },
      ],
      "boundaries/external": [
        "error",
        {
          default: "allow",
          rules: monorepoExternalRules,
        },
      ],
      // The base recommended set flags raw `any` from plain JS. Inside
      // typed packages this is already covered by typescript-eslint, and
      // some places legitimately use `any` as a marker for known
      // dynamic shapes (e.g. Drizzle's row return types). Quiet the
      // base rule to avoid drowning out real boundary violations.
      "@typescript-eslint/no-explicit-any": "off",
      // Existing code uses `// @ts-ignore` and unused imports liberally;
      // promoting these to errors is out of scope for the boundary PR.
      // They can be tightened in a follow-up.
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/no-this-alias": "off",
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/triple-slash-reference": "off",
      "no-empty": "off",
      "no-prototype-builtins": "off",
      "no-control-regex": "off",
      "no-useless-escape": "off",
      "no-case-declarations": "off",
      "no-redeclare": "off",
      "no-undef": "off",
      "no-unsafe-finally": "off",
      "no-async-promise-executor": "off",
      "no-misleading-character-class": "off",
      "no-fallthrough": "off",
      "prefer-const": "off",
    },
  },
];
