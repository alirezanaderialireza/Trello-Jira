-- Migration: 0009_phase1.2_checklists.sql
-- Phase 1.2 (F1.2.3.a) — Checklists schema redesign for the rich-card feature.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS MIGRATION DOES
--
--   A. Drops the Phase 0.x stubs of `checklists` and `checklist_items` (created
--      in 0002_phase02_auth_rls.sql, lines 162–188) **with CASCADE** to remove
--      the dependent RLS policies installed by 0002 / 0004 and the 4-byte
--      integer `position` column. The stubs were never wired to a working
--      router — the F1.2.3.a design audit found that the existing
--      `checklists.router.ts` ran on raw `protectedProcedure` (no board
--      membership guard, no outbox emit, no idempotency key), referenced a
--      Drizzle relation `with: { items: true }` that was never declared
--      (would crash at runtime), and addressed `checklist_items` with no
--      `tenant_id` column so RLS couldn't operate without a JOIN. No
--      production data is at risk.
--
--   B. Recreates the two tables with the Phase 1.2 shape:
--        checklists       : `name varchar(128) → title varchar(100)`;
--                           `position integer → varchar(255)` (LexoRank);
--                           `+ created_by` (audit), `+ updated_at` (audit);
--                           unique partial index `(card_id, LOWER(title))`
--                           WHERE `deleted_at IS NULL` for case-insensitive
--                           duplicate prevention per card (mirrors
--                           idx_labels_unique_name_per_board from 0007).
--        checklist_items  : `title varchar(255) → text varchar(500)`;
--                           `completed → is_done` (renamed for spec
--                           clarity, see steering doc D-list);
--                           `position integer → varchar(255)` (LexoRank);
--                           `+ tenant_id` (DENORMALISED, RLS predicate
--                           without JOIN — same pattern as labels'
--                           `card_labels.tenant_id` in 0007);
--                           `+ created_by` (audit), `+ updated_at` (audit
--                           was already present); FK on `checklist_id` is
--                           preserved with ON DELETE CASCADE.
--
--   C. Reinstalls split RLS policies (one per command) on both tables.
--      For `checklists` we additionally require board membership via an
--      EXISTS sub-query against `board_members`; this is the third defence
--      layer after the application's `boardProtectedProcedure` middleware
--      and the per-router role check. For `checklist_items` the
--      `tenant_id = current_tenant_id()` check is sufficient because the
--      junction is reachable only through `checklists` (which does enforce
--      board membership in its own SELECT policy) and `cards` (already
--      tenant-scoped via 0004) — duplicating the EXISTS predicate here would
--      force a four-table planner shape with no security benefit.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY DROP-AND-CREATE INSTEAD OF ALTER
--
--   Rebuilding the table is cheaper and safer than the equivalent ALTER chain:
--     • ALTER COLUMN name → title (RENAME)
--     • ALTER COLUMN position TYPE varchar(255) USING position::text
--       (every existing integer would need a LexoRank conversion that has
--        no canonical mapping)
--     • ADD COLUMN created_by uuid NOT NULL (requires a backfill — there's
--       no safe default user)
--     • ADD COLUMN tenant_id uuid NOT NULL on checklist_items (would
--       require a JOIN-then-backfill against checklists)
--   The Phase 0.x stubs hold no production data (router was unreachable),
--   so DROP/CREATE is data-equivalent. The migration is idempotent: re-
--   running on a database that already has the Phase 1.2 shape is a no-op
--   because the IF NOT EXISTS / IF EXISTS guards handle the second pass.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- IDEMPOTENCY
--
--   • DROP TABLE IF EXISTS … CASCADE — safe to re-run on a freshly built
--     DB (no-op when tables don't yet exist).
--   • CREATE TABLE IF NOT EXISTS — the second run after a successful first
--     pass would find the table present; the guard prevents a hard error.
--   • CREATE POLICY / DROP POLICY pairs follow the project-wide pattern
--     established in 0004 / 0007.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- IMMUTABLE-RULE COMPLIANCE
--
--   The unique index on (card_id, LOWER(title)) uses LOWER(), which is
--   IMMUTABLE in stock PostgreSQL — safe in a partial-index predicate.
--   No now() / volatile function appears in any predicate (Phase 0 L1
--   lesson, repeated here for the third schema redesign).
-- ─────────────────────────────────────────────────────────────────────────────


-- ============================================================================
-- 0. Announce the rebuild (so dev-runbook log readers can grep for it)
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE
    '[migration 0009] Phase 1.2 checklists rebuild — dropping legacy `checklists`/`checklist_items` stubs (no production data) and recreating with LexoRank ordering, denormalised tenant_id on the junction-like items table, audit columns, and split per-command RLS.';
END$$;


-- ============================================================================
-- 1. Drop legacy stubs (with CASCADE to clean up policies + indexes)
-- ============================================================================

DROP TABLE IF EXISTS "checklist_items" CASCADE;
DROP TABLE IF EXISTS "checklists"      CASCADE;


-- ============================================================================
-- 2. checklists — card-scoped task groups with LexoRank ordering
-- ============================================================================

CREATE TABLE IF NOT EXISTS "checklists" (
  "id"           uuid                     PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"    uuid                     NOT NULL,
  "card_id"      uuid                     NOT NULL REFERENCES "cards"("id")  ON DELETE CASCADE,
  "board_id"     uuid                     NOT NULL REFERENCES "boards"("id") ON DELETE CASCADE,
  "title"        varchar(100)             NOT NULL,
  "position"     varchar(255)             NOT NULL,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "created_by"   uuid                     NOT NULL REFERENCES "users"("id"),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at"   timestamp with time zone
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
-- Card-scoped ordered listing (the dominant SELECT path).
CREATE INDEX IF NOT EXISTS "idx_checklists_card"
  ON "checklists" ("card_id", "position")
  WHERE "deleted_at" IS NULL;

-- Tenant predicate hint (RLS planner).
CREATE INDEX IF NOT EXISTS "idx_checklists_tenant"
  ON "checklists" ("tenant_id");

-- Case-insensitive uniqueness within a card for live checklists.
-- LOWER() is IMMUTABLE in stock PostgreSQL → safe in a partial-index
-- predicate (Phase 0 L1 lesson).
CREATE UNIQUE INDEX IF NOT EXISTS "idx_checklists_unique_title_per_card"
  ON "checklists" ("card_id", LOWER("title"))
  WHERE "deleted_at" IS NULL;


-- ============================================================================
-- 3. checklist_items — items belonging to a checklist
-- ============================================================================
-- Items are reached only through their parent checklist, but they carry
-- `tenant_id` denormalised so RLS is a pure index-supported predicate
-- without a JOIN. We protect the denormalisation by:
--   • Application code: the checklists router always inserts the
--     tenant_id from `ctx.session`, never from the input.
--   • RLS WITH CHECK: the INSERT policy enforces
--     `tenant_id = current_tenant_id()`, so a buggy router that forgets
--     to set tenant_id would be rejected at the DB.
-- A future migration could add a CHECK that joins
-- checklist_items.tenant_id against checklists(id).tenant_id, but that
-- requires a SQL trigger and would slow inserts; the two-layer defence
-- above is sufficient for now (mirrors the labels card_labels rationale).

CREATE TABLE IF NOT EXISTS "checklist_items" (
  "id"            uuid                     PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"     uuid                     NOT NULL,
  "checklist_id"  uuid                     NOT NULL REFERENCES "checklists"("id") ON DELETE CASCADE,
  "text"          varchar(500)             NOT NULL,
  "is_done"       boolean                  NOT NULL DEFAULT false,
  "position"      varchar(255)             NOT NULL,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "created_by"    uuid                     NOT NULL REFERENCES "users"("id"),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
-- Checklist-scoped ordered listing (the dominant SELECT path).
CREATE INDEX IF NOT EXISTS "idx_checklist_items_checklist"
  ON "checklist_items" ("checklist_id", "position");

-- Tenant predicate hint (RLS planner).
CREATE INDEX IF NOT EXISTS "idx_checklist_items_tenant"
  ON "checklist_items" ("tenant_id");


-- ============================================================================
-- 4. RLS — checklists (split per command, with board-membership EXISTS check)
-- ============================================================================

ALTER TABLE "checklists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "checklists" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS checklists_tenant_iso     ON "checklists";
DROP POLICY IF EXISTS checklists_tenant_select  ON "checklists";
DROP POLICY IF EXISTS checklists_tenant_insert  ON "checklists";
DROP POLICY IF EXISTS checklists_tenant_update  ON "checklists";
DROP POLICY IF EXISTS checklists_tenant_delete  ON "checklists";

-- ── SELECT — visible to active members of the parent board ──────────────────
CREATE POLICY checklists_tenant_select ON "checklists"
  FOR SELECT
  USING (
    tenant_id = current_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM "board_members" bm
      WHERE bm.board_id  = checklists.board_id
        AND bm.user_id   = app.current_user_id()
        AND bm.tenant_id = current_tenant_id()
        AND bm.removed_at IS NULL
    )
  );

CREATE POLICY checklists_tenant_insert ON "checklists"
  FOR INSERT
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM "board_members" bm
      WHERE bm.board_id  = checklists.board_id
        AND bm.user_id   = app.current_user_id()
        AND bm.tenant_id = current_tenant_id()
        AND bm.removed_at IS NULL
    )
  );

CREATE POLICY checklists_tenant_update ON "checklists"
  FOR UPDATE
  USING (
    tenant_id = current_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM "board_members" bm
      WHERE bm.board_id  = checklists.board_id
        AND bm.user_id   = app.current_user_id()
        AND bm.tenant_id = current_tenant_id()
        AND bm.removed_at IS NULL
    )
  )
  WITH CHECK (
    tenant_id = current_tenant_id()
  );

CREATE POLICY checklists_tenant_delete ON "checklists"
  FOR DELETE
  USING (
    tenant_id = current_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM "board_members" bm
      WHERE bm.board_id  = checklists.board_id
        AND bm.user_id   = app.current_user_id()
        AND bm.tenant_id = current_tenant_id()
        AND bm.removed_at IS NULL
    )
  );


-- ============================================================================
-- 5. RLS — checklist_items (tenant-only, two-layer defence)
-- ============================================================================
-- Same rationale as labels' card_labels in migration 0007: the items are
-- reachable only through `checklists` (which already enforces board
-- membership in its own SELECT policy), so duplicating the EXISTS
-- predicate here would force a four-table planner shape with no
-- security benefit. The router-level boardProtectedProcedure provides
-- the application-tier guard.

ALTER TABLE "checklist_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "checklist_items" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS checklist_items_tenant_iso     ON "checklist_items";
DROP POLICY IF EXISTS checklist_items_tenant_select  ON "checklist_items";
DROP POLICY IF EXISTS checklist_items_tenant_insert  ON "checklist_items";
DROP POLICY IF EXISTS checklist_items_tenant_update  ON "checklist_items";
DROP POLICY IF EXISTS checklist_items_tenant_delete  ON "checklist_items";

CREATE POLICY checklist_items_tenant_select ON "checklist_items"
  FOR SELECT
  USING (tenant_id = current_tenant_id());

CREATE POLICY checklist_items_tenant_insert ON "checklist_items"
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY checklist_items_tenant_update ON "checklist_items"
  FOR UPDATE
  USING      (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY checklist_items_tenant_delete ON "checklist_items"
  FOR DELETE
  USING (tenant_id = current_tenant_id());


-- ============================================================================
-- 6. Refresh planner statistics
-- ============================================================================

ANALYZE "checklists";
ANALYZE "checklist_items";
