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


## Anti-pattern: schema drift via `drizzle-kit push`

Discovered during Phase 1.2 (F1.2.1) labels redesign. Migration 0007 had
to drop and recreate the `labels` and `card_labels` tables because the
0002 stubs were wired with the wrong shape (synthetic `id` PK on the
junction, no `tenant_id` denormalisation, hex `color` column instead of
the canonical `color_token` enum). The stubs were unreachable from any
production traffic — the existing `labels.router.ts` referenced an
undeclared Drizzle relation and would have crashed on the first call —
so the rebuild was data-equivalent. But the underlying smell is real:

> **Schema files in `packages/db/src/schema/*.ts` MUST always be backed
> by a migration that creates them. If you introduce a new table by
> editing the schema file alone and rely on `drizzle-kit push` to
> reconcile dev DBs, fresh-DB CI will diverge silently — the table
> won't exist when migrations stop at the last numbered file.**

Symptom in CI: tests on a fresh DB fail with `relation "X" does not
exist`, but every dev's local DB is fine because they ran `push` once.
The fix is always the same: add the missing migration **and** decide
whether downstream changes need to drop-and-rebuild.

### Recovery procedure (when discovered)
1. Confirm the table exists in `schema/index.ts` but has **no**
   corresponding `CREATE TABLE` statement in any numbered migration.
2. If the table holds production data, write an **ALTER**-style
   migration that brings the schema file into agreement with reality.
3. If the table is unreachable (broken router, no callers), write a
   **DROP TABLE IF EXISTS … CASCADE / CREATE TABLE …** rebuild as a
   single migration. Document the rebuild in the migration header
   (Phase 1.2's `0007_phase1.2_labels.sql` is the reference).
4. Always add a `RAISE NOTICE` at the top of a destructive migration so
   `psql` log readers can grep for "rebuild" / "dropped" events.

### Prevention
- Treat `drizzle-kit push` as a developer-only ergonomic for the
  current branch's WIP schema. **Never** ship a feature without the
  matching `*.sql` migration in the same PR.
- The PR review checklist should include: "Does every new table /
  column in `schema/*.ts` appear in the matching migration SQL?"
