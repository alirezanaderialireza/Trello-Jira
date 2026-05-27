---
inclusion: always
---

# Migration Authoring Rules

## TL;DR
- Every migration in `packages/db/migrations/` is **hand-written SQL**.
- **Do NOT run `pnpm --filter @repo/db generate`** to author new migrations
  — it will produce a snapshot that conflicts with our manual migrations.
- Drizzle `*.ts` schema files are kept **manually in sync** with the SQL
  migration that introduces each column. Schema and migration are reviewed
  together in the same PR.

## Why hand-written?
1. **RLS / CHECK constraints**: Drizzle generator does not emit them.
2. **Idempotency guards**: `DO $$ ... information_schema probe ... $$` blocks
   are required for safe re-application; generator does not produce them.
3. **Comment blocks**: every non-trivial migration ships an architecture-
   level comment block at the top (D2-style deviation notes, lifecycle
   invariants, role-enum sync notes). Generator strips these.
4. **Naming convention**: `NNNN_phaseXY_<topic>.sql` (4-digit pad, phase-
   namespaced). Generator names by hash, which is unreviewable.

## How to add a new migration
1. Find the next free number in `packages/db/migrations/meta/_journal.json`.
2. Create `packages/db/migrations/NNNN_phaseXY_<topic>.sql`.
3. Append a journal entry (idx, version: "7", when: epoch ms, tag, breakpoints: true).
4. Update affected `packages/db/src/schema/*.ts` files **in the same commit**.
5. Add a manual RLS test script at
   `packages/db/src/rls/__tests__/NNNN_<topic>.test.sql` if any RLS or
   CHECK was changed.
6. Reviewer verifies: schema TypeScript ⇄ SQL migration ⇄ test script
   describe the same shape.

## Pattern references (read before authoring)
- `0004_rls_split_policies.sql` — split-policy RLS pattern.
- `0006_phase11_shell_foundation.sql` — idempotent ALTER + CHECK +
  new tables + per-command RLS. The current canonical example.

## Forbidden
- `pnpm --filter @repo/db generate` after the initial scaffold.
- Editing or deleting an already-applied migration. Add a new one that
  reverses or extends.
- Skipping the SQL test script for a migration that touches RLS or
  CHECK constraints.

## Allowed
- `pnpm --filter @repo/db migrate` — applies pending migrations to local DB.
- Editing schema `*.ts` files when the column already exists in a
  migration (e.g. adding a Drizzle helper index that doesn't change SQL).
