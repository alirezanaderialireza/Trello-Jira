-- Migration: 0016_outbox_activity_indexes.sql
-- Phase 1.4 (M-04) — index the activity-feed query on outbox_events.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS MIGRATION DOES
--   The card/board activity feed (activity.router getByCard / getByBoard)
--   filters outbox_events by the JSONB fields payload->>'cardId' /
--   payload->>'boardId' and orders by occurred_at DESC. outbox_events is a
--   hot, append-only, ever-growing table (one row per mutation) and had no
--   index covering those expressions, so every timeline open did a sequential
--   scan that degrades as the table grows.
--
--   Add expression b-tree indexes leading with the JSONB key and trailing with
--   occurred_at DESC so the filter + ORDER BY are served by an index scan.
--
-- IDEMPOTENCY: CREATE INDEX IF NOT EXISTS — safe to re-run.
--
-- NOTE: when H-04 adds a first-class outbox_events.tenant_id column, prefer a
--   composite index led by tenant_id, e.g.
--     (tenant_id, (payload->>'cardId'), occurred_at DESC)
--   and drop these.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "idx_outbox_card_activity"
  ON "outbox_events" ((payload->>'cardId'), "occurred_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_outbox_board_activity"
  ON "outbox_events" ((payload->>'boardId'), "occurred_at" DESC);
