-- Migration: 0005_outbox_retry_count.sql
-- Phase 0.6 follow-up — durable retry tracking for the outbox worker.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS MIGRATION EXISTS (Bug #13)
--
-- The first version of the outbox worker tracked retry attempts in a process-
-- local `Map<eventId, number>`. That map was lost on every worker restart,
-- so a permanently-failing event could be retried far more than
-- OUTBOX_MAX_RETRIES (effectively forever) instead of being routed to the
-- DLQ. The retry counter has to live with the row, not the worker.
--
-- We add `retry_count` (integer, default 0) directly on `outbox_events` so
-- it is incremented in the same UPDATE that resets `processed_at = NULL`
-- after a publish failure. The DLQ decision then reads from the row, not
-- from the worker's memory.
--
-- A partial index is added on the (still-unprocessed) failed rows to keep
-- the DLQ scan cheap.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add the column with a safe default so existing rows are valid.
ALTER TABLE "outbox_events"
  ADD COLUMN IF NOT EXISTS "retry_count" integer NOT NULL DEFAULT 0;

-- 2. Index over rows that have failed at least once. This stays small
--    relative to the full table because most events succeed on first try.
CREATE INDEX IF NOT EXISTS "outbox_failed_idx"
  ON "outbox_events" ("retry_count")
  WHERE "processed_at" IS NULL AND "retry_count" > 0;
