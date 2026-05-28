-- Migration: 0008_phase1.2_due_date.sql
-- Phase 1.2 (F1.2.2) — Card due date as a first-class column.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS MIGRATION DOES
--
--   A. Adds a `due_date` DATE column to `cards` — wall-clock semantics, no
--      timezone shift. The user's Tehran-time "March 30" is the same row
--      value for a teammate viewing the board from Berlin or Vancouver.
--
--   B. Adds a partial index for the upcoming "overdue" / "due today"
--      filters (Phase 1.2 polish): only live cards with a due date are
--      indexed, so the index payload is small even on busy boards.
--
--   C. RLS is unchanged. RLS evaluates rows, not columns; the existing
--      `cards_tenant_*` policies installed by 0002 / 0004 already cover
--      the new column. A SQL test in
--      `packages/db/src/rls/__tests__/0008_due_date.test.sql` verifies
--      that a cross-tenant SELECT with `due_date IS NOT NULL` still
--      returns zero rows.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY DATE INSTEAD OF TIMESTAMPTZ
--
--   The Master Plan time-engine doctrine (steering: date-engine.md) is
--   explicit: a "due date" is a wall-clock fact ("the card must be done
--   by March 30"), NOT an instant in time. TIMESTAMPTZ would introduce
--   timezone shift — a card created with Tehran-midnight on March 30
--   would silently flip to "March 29" for users east of UTC+0. DATE is
--   timezone-agnostic and matches the doctrine.
--
--   The `isOverdue` helper in `apps/web/src/lib/date.ts` accepts both
--   `UTCDateTime` and `DateOnly`, so the client can compare a DATE
--   string ("2025-03-30") against today without converting.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY NOT BACKFILL FROM accounting_data
--
--   The previous stub of `due-date.router.ts` wrote ISO-8601 datetime
--   strings into `cards.accounting_data->>'dueDate'`. We deliberately
--   do NOT backfill those values into the new column because:
--
--     1. The stub was unreachable from the live UI (`boardApi.updateCardDueDate`
--        called a non-existent `card.updateDueDate` procedure — see the
--        F1.2.2 PR description for the audit).
--     2. The stub stored ISO datetimes ("2025-03-30T10:30:00Z"); the new
--        column is DATE. Truncating to the date portion would silently
--        round down a UTC midnight that the user actually meant to be
--        Tehran-tomorrow.
--     3. Any data the stub wrote is non-canonical and should be re-entered
--        by the user once the new picker ships.
--
--   The accounting_data JSONB cleanup (removing the stale `dueDate` key)
--   is parked for the Phase 1.5 janitor PR.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- IDEMPOTENCY
--
--   ADD COLUMN IF NOT EXISTS — safe to re-run on a freshly built DB AND
--   on a dev DB that already applied 0008.
--   CREATE INDEX IF NOT EXISTS — same.
-- ─────────────────────────────────────────────────────────────────────────────


-- ============================================================================
-- 0. Announce the column add (so dev-runbook log readers can grep for it)
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE
    '[migration 0008] Phase 1.2 due-date — adding cards.due_date DATE column (wall-clock semantics, no TZ shift) + partial index for overdue queries.';
END$$;


-- ============================================================================
-- 1. Add cards.due_date  (DATE, NULL allowed)
-- ============================================================================

ALTER TABLE "cards"
  ADD COLUMN IF NOT EXISTS "due_date" date;


-- ============================================================================
-- 2. Partial index for overdue / due-today queries
-- ============================================================================
-- Indexes only live, scheduled cards — null and soft-deleted rows aren't
-- candidates for the "what's due?" sweep. Tenant-scoped first column so
-- the planner can satisfy `tenant_id = $1 AND due_date < CURRENT_DATE`
-- with an index-only scan.
--
-- IMMUTABLE rule (Phase 0 L1): the predicate uses only `due_date IS NOT NULL`
-- and `deleted_at IS NULL` — both immutable. No `now()` or `CURRENT_DATE`
-- appears in the predicate.

CREATE INDEX IF NOT EXISTS "idx_cards_due_date"
  ON "cards" ("tenant_id", "due_date")
  WHERE "due_date" IS NOT NULL
    AND "deleted_at" IS NULL;


-- ============================================================================
-- 3. Refresh planner statistics
-- ============================================================================

ANALYZE "cards";
