-- Migration: 0011_phase1.2_card_assignees.sql
-- Phase 1.2 (F1.2.5) — Card Assignees junction table.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS MIGRATION DOES
--
--   Creates a new `card_assignees` junction table linking cards to their
--   assigned users. This replaces the Phase-4 rich-card stub which stored
--   assignees as a text[] on the cards row — that approach had no FK,
--   no audit trail, and no RLS predicate.
--
--   Key design decisions (D1):
--     • Composite PK (card_id, user_id) — no synthetic id needed.
--     • `tenant_id` denormalised for RLS without JOIN (same rationale as
--       card_labels and checklist_items from 0007/0009).
--     • `assigned_by varchar(128)` NOT NULL — audit trail for Activity
--       Timeline (F1.2.8). varchar(128) matches the existing
--       board_members.user_id column type (D9 from F3b).
--     • `assigned_at timestamptz NOT NULL DEFAULT now()` — ordering +
--       audit.
--     • Reverse index (tenant_id, user_id) for the "My Cards" feature
--       (F1.5) so the query `WHERE user_id = ? AND tenant_id = ?` is
--       index-supported.
--
--   RLS rationale:
--     tenant-only check (no board_members EXISTS) — card_assignees rows are
--     reachable only through cards (which already enforces board membership
--     via the boardProtectedProcedure). Duplicating the EXISTS predicate
--     here would force a four-table planner shape with no security benefit.
--     Mirrors the rationale for card_labels in 0007 and checklist_items
--     in 0009.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- IDEMPOTENCY
--   • CREATE TABLE IF NOT EXISTS — safe to re-run.
--   • DROP POLICY IF EXISTS + CREATE POLICY — safe to re-run.
--   • CREATE INDEX IF NOT EXISTS — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- ============================================================================
-- 0. Announce the migration
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE
    '[migration 0011] Phase 1.2 F1.2.5 — creating card_assignees junction table '
    'with denormalised tenant_id, assigned_by/at audit columns, composite PK, '
    'reverse-lookup index for "My Cards" (F1.5), and split per-command RLS.';
END$$;


-- ============================================================================
-- 1. card_assignees table
-- ============================================================================

CREATE TABLE IF NOT EXISTS "card_assignees" (
  "card_id"     uuid         NOT NULL REFERENCES "cards"("id")  ON DELETE CASCADE,
  "user_id"     varchar(128) NOT NULL REFERENCES "users"("id")  ON DELETE CASCADE,
  "tenant_id"   uuid         NOT NULL,
  "assigned_by" varchar(128) NOT NULL REFERENCES "users"("id"),
  "assigned_at" timestamp with time zone NOT NULL DEFAULT now(),

  PRIMARY KEY ("card_id", "user_id")
);


-- ============================================================================
-- 2. Indexes
-- ============================================================================

-- "My Cards" reverse lookup — the dominant query for F1.5 sidebar filter.
CREATE INDEX IF NOT EXISTS "idx_card_assignees_user"
  ON "card_assignees" ("tenant_id", "user_id");

-- RLS planner hint (mirrors idx_comments_tenant in 0010).
CREATE INDEX IF NOT EXISTS "idx_card_assignees_tenant"
  ON "card_assignees" ("tenant_id");


-- ============================================================================
-- 3. Row Level Security
-- ============================================================================

ALTER TABLE "card_assignees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "card_assignees" FORCE  ROW LEVEL SECURITY;

-- Drop any legacy policies before recreating (idempotency guard).
DROP POLICY IF EXISTS card_assignees_tenant_iso    ON "card_assignees";
DROP POLICY IF EXISTS card_assignees_tenant_select ON "card_assignees";
DROP POLICY IF EXISTS card_assignees_tenant_insert ON "card_assignees";
DROP POLICY IF EXISTS card_assignees_tenant_update ON "card_assignees";
DROP POLICY IF EXISTS card_assignees_tenant_delete ON "card_assignees";


-- SELECT — tenant isolation only (no board_members EXISTS — see rationale above).
CREATE POLICY card_assignees_tenant_select ON "card_assignees"
  FOR SELECT
  USING (tenant_id = current_tenant_id());

-- INSERT — WITH CHECK enforces tenant provenance (router supplies from session).
CREATE POLICY card_assignees_tenant_insert ON "card_assignees"
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());

-- UPDATE — guard both old and new row shapes.
CREATE POLICY card_assignees_tenant_update ON "card_assignees"
  FOR UPDATE
  USING      (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- DELETE — tenant isolation.
CREATE POLICY card_assignees_tenant_delete ON "card_assignees"
  FOR DELETE
  USING (tenant_id = current_tenant_id());


-- ============================================================================
-- 4. Refresh planner statistics
-- ============================================================================

ANALYZE "card_assignees";
