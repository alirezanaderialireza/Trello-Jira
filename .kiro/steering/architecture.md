---
inclusion: always
---

# Architecture Rules

This document captures the layered architecture that the codebase is built
around, and points at the linter that enforces it. Read it before adding a
new package, moving code between packages, or refactoring an import that
crosses package boundaries.

> The lint rules in `eslint.config.mjs` (root) and `apps/web/eslint.config.mjs`
> are the **runtime enforcement** of this document. If the doc and the
> linter ever disagree, the linter is the source of truth — fix the doc to
> match.

---

## The layered model

```
┌─────────────────────────────────────────────────────────────┐
│ app          (apps/web/src/app — Next.js routes/pages)      │
│   ↓ may import                                              │
│   feature, web-shared, infrastructure-bridge, auth-bridge   │
├─────────────────────────────────────────────────────────────┤
│ feature      (apps/web/src/features/* — UI modules)         │
│   ↓ may import                                              │
│   own feature, web-shared, infrastructure-bridge,           │
│   auth-bridge,  + @repo/domain (TYPES only),                │
│   + @repo/domain/ordering (LexoRank primitives)             │
├─────────────────────────────────────────────────────────────┤
│ web-shared   (apps/web/src/{components,lib,utils,hooks,...})│
│   ↓ may import                                              │
│   web-shared                                                │
├─────────────────────────────────────────────────────────────┤
│ api          (packages/api/src — tRPC routers, services)     │
│   ↓ may import                                              │
│   domain, db, infrastructure, auth                          │
├─────────────────────────────────────────────────────────────┤
│ infrastructure (packages/infrastructure/src)                 │
│   ↓ may import                                              │
│   domain (ports/types), auth                                │
├─────────────────────────────────────────────────────────────┤
│ db           (packages/db/src — Drizzle schema + repos)      │
│   ↓ may import                                              │
│   domain (ports/types)                                      │
├─────────────────────────────────────────────────────────────┤
│ auth         (packages/auth/src — JWT, password hashing)     │
│   ↓ may import                                              │
│   domain                                                    │
├─────────────────────────────────────────────────────────────┤
│ domain       (packages/domain/src — Pure business logic)     │
│   ↓ may import                                              │
│   nothing  (no I/O, no UI, no Drizzle, no Redis,            │
│             no React, no Next.js, no dayjs, no @trpc/*)     │
└─────────────────────────────────────────────────────────────┘
```

Two lint configs split this in half:

- **Root `eslint.config.mjs`** governs `packages/**/src/**`. The strict
  monorepo-level rules live here. Violations are **errors** (CI-blocking).
- **`apps/web/eslint.config.mjs`** governs `apps/web/src/**`. It enforces
  within-app layering (app / feature / web-shared / infrastructure-bridge /
  auth-bridge) and forbids feature code from reaching `@repo/db` /
  `@repo/domain` at runtime. See the "Migration" section below for the
  current severity.

---

## The five golden bans

These never happen. The linter catches them; the doc explains why.

1. `app` or `feature` → `@repo/db` at runtime
   _UI never touches the database directly. Always go through a server
   action or tRPC route._

2. `domain` → `db`, `infrastructure`, `react`, `next`, `dayjs`, `drizzle-orm`, `ioredis`, `@trpc/*`
   _Domain is pure business logic. Anything I/O is injected through a
   port._

3. `db` → `api`, `feature`, `next`, `react`, `@trpc/*`
   _The DB layer must not know HTTP, UI, or tRPC exists._

4. `packages/*` → `apps/*`
   _Packages are independent of any specific app. The reverse direction
   is fine; this direction creates a cycle._

5. `feature/A` → `feature/B/internals`
   _Features only see each other through their `index.ts` public surface.
   Reaching into `feature/B/store/...` couples them and defeats the
   modular structure._

---

## Type-only carveout

The doctrine "feature can only import domain TYPES" is enforced by
`allowTypeImports: true` on the relevant `no-restricted-imports` paths.
This pattern works:

```ts
// ✓ allowed — type-only, erased at compile time
import type { Card } from "@repo/domain";

// ✗ blocked — runtime function call
import { generatePosition } from "@repo/domain";

// ✓ allowed — LexoRank is exposed under its own subpath as a
//   shared utility (not a domain handler).
import { generatePosition } from "@repo/domain/ordering";
```

`@repo/domain/ordering` is the one runtime carveout. The LexoRank
primitives are pure deterministic functions, used by client-side
optimistic positioning. They get their own subpath in
`packages/domain/package.json` `exports` so the carveout is explicit at
the import site.

---

## How the linter is wired

| Layer       | Lint script                                             |
|-------------|---------------------------------------------------------|
| packages/*  | `eslint src --max-warnings=0` (strict — warnings fail)  |
| apps/web    | `eslint src` (warnings tolerated during the migration)  |
| Root        | `pnpm lint` → `turbo run lint` → fans out to each above |

CI (`.github/workflows/ci.yml`) runs `pnpm lint` BEFORE typecheck so a
layering regression fails fast.

ESLint flat-config walks UP from the current directory looking for the
closest `eslint.config.mjs`. When `pnpm --filter @repo/db lint` runs, it
finds the root config; when `pnpm --filter web lint` runs, it finds the
apps/web config. The two configs do not interfere.

The boundary plugin patterns use `**/packages/<name>/src/**` (with the
`**/` prefix) so they match regardless of which directory ESLint is
invoked from.

---

## Pitfalls

### 1. Adding a new package
Walk through this checklist:

1. Add a `lint` script to its `package.json`:
   ```json
   "lint": "eslint src --max-warnings=0"
   ```
2. In root `eslint.config.mjs`, append a new entry to `monorepoElements`
   describing the layer type.
3. Append an entry to `monorepoRules` listing what the new layer may
   import.
4. If the package should never see UI runtime libraries, add an entry to
   `monorepoExternalRules` mirroring the existing patterns for `domain`.
5. Run `pnpm lint` — if it passes, the package is wired in.

### 2. Type imports vs runtime imports
TypeScript's `import type {}` is erased at compile time. The boundary
linter does NOT chase type imports; the per-path `allowTypeImports: true`
flag in `no-restricted-imports` does. Both work together: the type-only
form is allowed everywhere; runtime imports follow the layer rules.

### 3. Tests are exempt
`**/*.{test,spec}.{ts,tsx}` and `**/__tests__/**` are excluded from the
boundary settings (`boundaries/ignore`). A reducer test can legitimately
import a domain handler to exercise it; the linter will not complain.

### 4. Migration files are exempt
`**/packages/db/migrations/**` is excluded. Backfill scripts and SQL
migrations have no architectural layer.

### 5. The `apps/**` is ignored by the root config
The root config's `ignores` list explicitly excludes `apps/**` so we
don't double-lint the same files. `apps/web` has its own dedicated
config; future apps (e.g. mobile, admin) will follow the same pattern.

### 6. Disabling a rule needs a reason
If you ever genuinely cannot satisfy the layer rule, prefix the disable
comment with a TODO that points at a refactor task:

```ts
// eslint-disable-next-line boundaries/element-types -- TODO ISSUE-NNN: refactor X to Y
import { thing } from "../bad/path";
```

A bare `eslint-disable` without a reason is a code smell; reviewers
should reject PRs that add one.

---

## Current state and migration

**Strict (errors, CI-blocking):**

- All five `packages/*` (api, db, domain, infrastructure, auth)
- The date-engine boundary in `apps/web` (no direct dayjs imports)
- The `@repo/db` / `@repo/domain` runtime block in `apps/web/src/features/**`

**Warning (tolerated for one cycle, then promoted):**

- `boundaries/element-types` in `apps/web`. There are 16 pre-existing
  violations under `apps/web/src/infrastructure/platform/*` where
  client-side infrastructure imports from a feature. The lint script
  surfaces them as warnings without blocking merges. The promotion path
  (warn → error) is documented inline in `apps/web/eslint.config.mjs`.

When the warning count reaches zero, change the severity in apps/web's
config from `"warn"` to `"error"` and tighten its `lint` script with
`--max-warnings=0`.

---

## What is intentionally deferred

- **A pre-commit hook** running lint-staged against changed files. The
  full repo lint runs in <5 s already, so adding lint-staged buys
  marginal speed and adds tooling complexity.
- **Cycle detection** via `eslint-plugin-import` `import/no-cycle`. The
  layer rules already block the most common cycle (UI → DB → UI), and
  TypeScript's compiler would surface a runtime cycle anyway.
- **Per-feature isolation rules**. `apps/web`'s config detects
  feature/A → feature/B/internals via boundaries' folder-mode, but no
  rule yet enforces that cross-feature imports go through `index.ts`
  only. That can be added with `boundaries/entry-point` once feature
  modules grow further.
- **Demoting the apps/web warning** from boundaries violations to
  errors. Tracked as a follow-up PR — fix or annotate the 16 hits in
  `apps/web/src/infrastructure/platform/*` first.
