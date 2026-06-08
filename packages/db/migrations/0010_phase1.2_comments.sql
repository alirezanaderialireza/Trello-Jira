-- Migration: 0010_phase1.2_comments.sql
-- Phase 1.2 (F1.2.4.a) — Comments schema hardening.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS MIGRATION DOES
--
--   A. Drift analysis:
--      The `comments` table was created in the Phase-4 rich-card stub but
--      with several missing pieces compared to the F1.2.x contract:
--        • No `revision` column (required for OCC + event version tracking)
--        • No `updated_at` column (required for audit trail / activity timeline)
--        • No `deleted_by` column (required for D5 delete author attribution)
--        • No RLS policies (table was accessible to any authenticated user
--          across tenants — critical gap)
--        • `authorId` was `varchar(128)` but should be `uuid` FK to users
--          (kept as varchar for backward compat — migration note below)
--        • body length cap was 10000 — reduced to 5000 (D3)
--
--   B. This migration uses ALTER (not DROP/CREATE) because the router's
--      `create` procedure was reachable from production traffic (unlike the
--      checklists stubs). Data preservation is the safe default (D1=ALTER).
--
--   C. Schema changes:
--        ADD COLUMN revision     integer NOT NULL DEFAULT 0
--        ADD COLUMN updated_at   timestamptz NOT NULL DEFAULT now()
--        ADD COLUMN deleted_by   uuid (nullable — FK to users)
--      Index additions:
--        idx_comments_tenant — planner hint for RLS predicate
--      RLS:
--        ENABLE + FORCE ROW LEVEL SECURITY
--        Four split-command policies with tenant_id + board_members EXISTS
--
--   NOTE on authorId column:
--      The original stub declared `authorId varchar(128)` instead of
--      `uuid references users(id)`. Altering this column type would break
--      existing rows (UUID cast from varchar is safe but requires USING
--      clause and a temporary index). Since this is a non-critical audit
--      field (server always writes ctx.session.user.id, never client input)
--      and the column already contains valid UUID strings in practice,
--      we leave the column type unchanged and document it as a known
--      minor drift. A future cleanup migration can perform the cast safely
--      once confirmed against production data.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- IDEMPOTENCY
--
--   • ADD COLUMN IF NOT EXISTS — safe to re-run
--   • DROP POLICY IF EXISTS + CREATE POLICY — safe to re-run
--   • CREATE INDEX IF NOT EXISTS — safe to re-run
-- ─────────────────────────────────────────────────────────────────────────────
-- IMMUTABLE-RULE COMPLIANCE
--
--   No now() or volatile functions in index predicates.
--   WHERE deleted_at IS NULL on existing indexes is a simple NULL check —
--   no function call — IMMUTABLE-safe per Phase 0 L1 lesson.
-- ─────────────────────────────────────────────────────────────────────────────

-- ============================================================================
-- 0. Announce the migration
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE
    '[migration 0010] Phase 1.2 comments hardening — adding revision/updated_at/deleted_by columns, enabling RLS with split per-command policies (tenant + board membership), adding tenant index.';
END$$;


-- ============================================================================
-- 1. Add missing audit + OCC columns
-- ============================================================================

ALTER TABLE "comments"
  ADD COLUMN IF NOT EXISTS "revision"   integer                  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "deleted_by" uuid                     REFERENCES "users"("id");


-- ============================================================================
-- 2. Add tenant planner-hint index
-- ============================================================================

CREATE INDEX IF NOT EXISTS "idx_comments_tenant"
  ON "comments" ("tenant_id");


-- ============================================================================
-- 3. Enable Row Level Security
-- ============================================================================

ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "comments" FORCE  ROW LEVEL SECURITY;


-- ============================================================================
-- 4. Drop any existing policies (idempotent re-run guard)
-- ============================================================================

DROP POLICY IF EXISTS comments_tenant_iso     ON "comments";
DROP POLICY IF EXISTS comments_tenant_select  ON "comments";
DROP POLICY IF EXISTS comments_tenant_insert  ON "comments";
DROP POLICY IF EXISTS comments_tenant_update  ON "comments";
DROP POLICY IF EXISTS comments_tenant_delete  ON "comments";


-- ============================================================================
-- 5. Split per-command RLS policies
--    Pattern: checklists in 0009 + board_members EXISTS check.
--    comments are card-scoped so membership is implied by the card's
--    board — we gate on the comment's own board_id against board_members.
-- ============================================================================

-- SELECT — visible to active members of the comment's board
CREATE POLICY comments_tenant_select ON "comments"
  FOR SELECT
  USING (
    tenant_id = current_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM "board_members" bm
      WHERE bm.board_id  = comments.board_id
        AND bm.user_id   = app.current_user_id()
        AND bm.tenant_id = current_tenant_id()
        AND bm.removed_at IS NULL
    )
  );

-- INSERT — board members may create comments
CREATE POLICY comments_tenant_insert ON "comments"
  FOR INSERT
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM "board_members" bm
      WHERE bm.board_id  = comments.board_id
        AND bm.user_id   = app.current_user_id()
        AND bm.tenant_id = current_tenant_id()
        AND bm.removed_at IS NULL
    )
  );

-- UPDATE — author or admin can update (router enforces inline; RLS is the
--           third layer — we allow any board member at DB level, router is strict)
CREATE POLICY comments_tenant_update ON "comments"
  FOR UPDATE
  USING (
    tenant_id = current_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM "board_members" bm
      WHERE bm.board_id  = comments.board_id
        AND bm.user_id   = app.current_user_id()
        AND bm.tenant_id = current_tenant_id()
        AND bm.removed_at IS NULL
    )
  )
  WITH CHECK (tenant_id = current_tenant_id());

-- DELETE — soft-delete is an UPDATE in practice; hard-delete guard matches UPDATE
CREATE POLICY comments_tenant_delete ON "comments"
  FOR DELETE
  USING (
    tenant_id = current_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM "board_members" bm
      WHERE bm.board_id  = comments.board_id
        AND bm.user_id   = app.current_user_id()
        AND bm.tenant_id = current_tenant_id()
        AND bm.removed_at IS NULL
    )
  );


-- ============================================================================
-- 6. Refresh planner statistics
-- ============================================================================

ANALYZE "comments";
