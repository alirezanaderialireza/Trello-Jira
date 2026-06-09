-- Migration: 0015_cleanup_stale_due_date_jsonb.sql
-- Phase 1.4 (F1.4.3) — Janitor: remove stale `dueDate` key from
-- cards.accounting_data.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS MIGRATION DOES
--
--   The pre-F1.2.2 due-date stub wrote ISO-8601 datetime strings into
--   cards.accounting_data->>'dueDate' (e.g. {"dueDate":"2026-03-30T10:00:00Z"}).
--   Since migration 0008_phase1.2_due_date.sql, due dates live in the
--   first-class cards.due_date DATE column. The stale JSONB key is now
--   orphaned and misleading. This migration removes ONLY the root `dueDate`
--   key from accounting_data.
--
--   This was explicitly parked for the "Phase 1.5 janitor" in
--   due-date-conventions.md / the 0008 header; it is now performed here in
--   F1.4.3.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- SAFETY
--
--   • No live code reads or writes accounting_data — a repo-wide grep found
--     only historical references in comments and the schema definition, so
--     removing the stale value is inert for the current application.
--   • Real accounting-module envelopes (per the architecture) carry root keys
--     version + module_type + data, and NEVER a root `dueDate`. The
--     `NOT (accounting_data ? 'module_type')` guard guarantees we never touch
--     real module data — even a hypothetical mixed/corrupt row that carried
--     BOTH a root `dueDate` AND `module_type` is left untouched for manual
--     review.
--   • Surgical: only the root `dueDate` key is removed (`- 'dueDate'`). All
--     other keys are preserved.
--   • If the object becomes empty ('{}') after key removal, it is set to NULL
--     (NULLIF), so we don't leave behind empty-object noise.
--   • The accounting_data COLUMN is preserved (reserved for the future
--     accounting module). This migration never drops the column.
--   • Idempotent: after the cleanup no row matches the predicate, so a
--     re-run updates zero rows.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  affected integer;
BEGIN
  UPDATE cards
  SET accounting_data = NULLIF(accounting_data - 'dueDate', '{}'::jsonb)
  WHERE accounting_data ? 'dueDate'
    AND NOT (accounting_data ? 'module_type');

  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'F1.4.3 janitor: cleaned stale dueDate key from % card(s).', affected;
END $$;
