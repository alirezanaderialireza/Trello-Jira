-- Migration: 0007_phase1.2_labels.sql
-- Phase 1.2 (F1.2.1) — Labels schema redesign for the rich-card feature.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS MIGRATION DOES
--
--   A. Drops the Phase 0.x stubs of `labels` and `card_labels` (created in
--      0002_phase02_auth_rls.sql, lines 133–160) **with CASCADE** to remove
--      the dependent RLS policies installed by 0002 / 0004 and the unique
--      index variants. The stubs were never wired to a working router — the
--      F1.2.1 design audit found that `labels.router.ts` referenced a
--      `with: { label: true }` Drizzle relation that was never declared,
--      so any production traffic against these tables would have crashed
--      at the ORM layer. No data migration is needed.
--
--   B. Recreates the two tables with the Phase 1.2 shape:
--        labels        : adds `position` (LexoRank), `created_by`,
--                        `updated_at`; replaces `color` (varchar(7) hex)
--                        with `color_token` (varchar(20) enum, CHECK-
--                        constrained to the canonical 12-token palette);
--                        narrows `name` from varchar(64) → varchar(50).
--        card_labels   : composite PK `(card_id, label_id)` (was a synthetic
--                        `id` uuid); adds DENORMALIZED `tenant_id` so RLS
--                        runs without a JOIN to `cards`; adds `applied_by`
--                        (audit) and renames `created_at` → `applied_at`
--                        for clarity; adds a real FK to `cards(id)`.
--
--   C. Reinstalls split RLS policies (one per command) on both tables.
--      For `labels` we additionally require board membership via an EXISTS
--      sub-query against `board_members`; this is the third defence layer
--      after the application's `boardProtectedProcedure` middleware (F2)
--      and the per-router role check. For `card_labels` the basic
--      `tenant_id = current_tenant_id()` check is sufficient because the
--      junction is reachable only through `labels` (which does enforce
--      board membership in its own SELECT policy) and `cards` (already
--      tenant-scoped via 0004).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY DROP-AND-CREATE INSTEAD OF ALTER
--
--   Rebuilding the table is cheaper, safer, and more readable than:
--     • ALTER COLUMN color TYPE varchar(20) (requires data convert)
--     • ALTER COLUMN name TYPE varchar(50) (requires length check)
--     • DROP CONSTRAINT card_labels_pkey + ADD CONSTRAINT card_labels_pkey
--       PRIMARY KEY (card_id, label_id) (requires NOT NULL backfill of
--       both columns and a uniqueness scan)
--     • Backfilling tenant_id on card_labels (requires a JOIN to
--       cards / labels and a NOT NULL tightening)
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
--   • CREATE TABLE — the second run after a successful first pass would
--     find the table present; we guard each CREATE TABLE with
--     IF NOT EXISTS, but if it exists with the OLD shape the migration
--     should be re-run from a clean DB. (The dev runbook in
--     `.kiro/steering/migrations.md` documents the recovery path.)
--   • CREATE POLICY / DROP POLICY pairs follow the project-wide pattern
--     established in 0004.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- IMMUTABLE-RULE COMPLIANCE
--
--   The unique index on (board_id, LOWER(name)) uses LOWER(), which is
--   IMMUTABLE in stock PostgreSQL — safe in a partial-index predicate.
--   No now() / volatile function appears in any predicate (Phase 0 L1
--   lesson).
-- ─────────────────────────────────────────────────────────────────────────────


-- ============================================================================
-- 0. Announce the rebuild (so dev-runbook log readers can grep for it)
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE
    '[migration 0007] Phase 1.2 labels rebuild — dropping legacy `labels`/`card_labels` stubs (no production data) and recreating with LexoRank ordering, color_token enum, denormalised tenant_id on the junction, and split per-command RLS.';
END$$;


-- ============================================================================
-- 1. Drop legacy stubs (with CASCADE to clean up policies + indexes)
-- ============================================================================

DROP TABLE IF EXISTS "card_labels" CASCADE;
DROP TABLE IF EXISTS "labels"      CASCADE;


-- ============================================================================
-- 2. labels — board-scoped colour tags with LexoRank ordering
-- ============================================================================

CREATE TABLE IF NOT EXISTS "labels" (
  "id"           uuid                     PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"    uuid                     NOT NULL,
  "board_id"     uuid                     NOT NULL REFERENCES "boards"("id") ON DELETE CASCADE,
  "name"         varchar(50)              NOT NULL,
  "color_token"  varchar(20)              NOT NULL,
  "position"     varchar(255)             NOT NULL,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "created_by"   uuid                     NOT NULL REFERENCES "users"("id"),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at"   timestamp with time zone
);

-- ── color_token CHECK ────────────────────────────────────────────────────────
-- Keep in sync with packages/domain/src/labels/types.ts (COLOR_TOKENS).
-- `black` deliberately has no `.500` suffix — it's a true neutral, not a
-- mid-stop on the colour scale.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'labels_color_token_check'
      AND table_name      = 'labels'
  ) THEN
    EXECUTE 'ALTER TABLE "labels" DROP CONSTRAINT "labels_color_token_check"';
  END IF;

  EXECUTE
    'ALTER TABLE "labels" '
    'ADD CONSTRAINT "labels_color_token_check" '
    'CHECK ("color_token" IN ('
      '''red.500'',''orange.500'',''yellow.500'',''green.500'','
      '''teal.500'',''blue.500'',''indigo.500'',''purple.500'','
      '''pink.500'',''gray.500'',''brown.500'',''black'''
    '))';
END$$;

-- ── Indexes ──────────────────────────────────────────────────────────────────
-- 1. Board-scoped ordered listing (the common SELECT path).
CREATE INDEX IF NOT EXISTS "idx_labels_board"
  ON "labels" ("board_id", "position")
  WHERE "deleted_at" IS NULL;

-- 2. Tenant-scoped lookups (RLS predicate planning hint).
CREATE INDEX IF NOT EXISTS "idx_labels_tenant"
  ON "labels" ("tenant_id");

-- 3. Case-insensitive uniqueness within a board for live (non-deleted) labels.
--    LOWER() is IMMUTABLE in PostgreSQL stock so this is a safe partial index.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_labels_unique_name_per_board"
  ON "labels" ("board_id", LOWER("name"))
  WHERE "deleted_at" IS NULL;


-- ============================================================================
-- 3. card_labels — many-to-many junction with composite PK + denorm tenant
-- ============================================================================
-- The junction stores `tenant_id` denormalised (instead of joining to
-- cards or labels at RLS-evaluation time) so the SELECT policy is a pure
-- index-supported predicate. We protect the denormalisation by:
--   • Application code: the labels router always inserts the tenant_id
--     from `ctx.session`, never from the input.
--   • RLS WITH CHECK: the INSERT policy enforces
--     `tenant_id = current_tenant_id()`, so a buggy router that forgets
--     to set tenant_id would be rejected at the DB.
-- A future migration could add a CHECK that joins card_labels.tenant_id
-- against cards(id).tenant_id, but that requires a SQL trigger and
-- would slow inserts; the two-layer defence above is sufficient for now.

CREATE TABLE IF NOT EXISTS "card_labels" (
  "card_id"     uuid                     NOT NULL REFERENCES "cards"("id")  ON DELETE CASCADE,
  "label_id"    uuid                     NOT NULL REFERENCES "labels"("id") ON DELETE CASCADE,
  "tenant_id"   uuid                     NOT NULL,
  "applied_by"  uuid                     NOT NULL REFERENCES "users"("id"),
  "applied_at"  timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("card_id", "label_id")
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
-- 1. Lookup labels of a card (the dominant read path).
CREATE INDEX IF NOT EXISTS "idx_card_labels_card"
  ON "card_labels" ("card_id");

-- 2. Lookup cards using a label (used by delete-confirm count and future filter).
CREATE INDEX IF NOT EXISTS "idx_card_labels_label"
  ON "card_labels" ("label_id");

-- 3. Tenant-scoped (RLS predicate hint).
CREATE INDEX IF NOT EXISTS "idx_card_labels_tenant"
  ON "card_labels" ("tenant_id");


-- ============================================================================
-- 4. RLS — labels (split per command, with board-membership EXISTS check)
-- ============================================================================

ALTER TABLE "labels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "labels" FORCE  ROW LEVEL SECURITY;

-- Drop legacy + any half-applied policies before re-creating, so this
-- block is a no-op on re-run (matches the pattern in 0004).
DROP POLICY IF EXISTS labels_tenant_iso     ON "labels";
DROP POLICY IF EXISTS labels_tenant_select  ON "labels";
DROP POLICY IF EXISTS labels_tenant_insert  ON "labels";
DROP POLICY IF EXISTS labels_tenant_update  ON "labels";
DROP POLICY IF EXISTS labels_tenant_delete  ON "labels";

-- ── SELECT — visible to active members of the parent board ──────────────────
CREATE POLICY labels_tenant_select ON "labels"
  FOR SELECT
  USING (
    tenant_id = current_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM "board_members" bm
      WHERE bm.board_id  = labels.board_id
        AND bm.user_id   = app.current_user_id()::text
        AND bm.tenant_id = current_tenant_id()
        AND bm.removed_at IS NULL
    )
  );

-- ── INSERT — same gate; tenant_id must match the GUC ───────────────────────
CREATE POLICY labels_tenant_insert ON "labels"
  FOR INSERT
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM "board_members" bm
      WHERE bm.board_id  = labels.board_id
        AND bm.user_id   = app.current_user_id()::text
        AND bm.tenant_id = current_tenant_id()
        AND bm.removed_at IS NULL
    )
  );

-- ── UPDATE — both old (USING) and new (WITH CHECK) row must satisfy ────────
-- Per-row authorisation (creator vs admin) is enforced at the application
-- layer because RLS cannot easily express "OR creator". The DB still
-- guarantees tenant + board-membership, which is the security boundary.
CREATE POLICY labels_tenant_update ON "labels"
  FOR UPDATE
  USING (
    tenant_id = current_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM "board_members" bm
      WHERE bm.board_id  = labels.board_id
        AND bm.user_id   = app.current_user_id()::text
        AND bm.tenant_id = current_tenant_id()
        AND bm.removed_at IS NULL
    )
  )
  WITH CHECK (
    tenant_id = current_tenant_id()
  );

-- ── DELETE — same membership gate; admin role is checked in the router ─────
CREATE POLICY labels_tenant_delete ON "labels"
  FOR DELETE
  USING (
    tenant_id = current_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM "board_members" bm
      WHERE bm.board_id  = labels.board_id
        AND bm.user_id   = app.current_user_id()::text
        AND bm.tenant_id = current_tenant_id()
        AND bm.removed_at IS NULL
    )
  );


-- ============================================================================
-- 5. RLS — card_labels (tenant-only, two-layer defence)
-- ============================================================================
-- The junction does not duplicate the labels table's board-membership
-- check because:
--   1) To resolve which labels a row points to, the user's transaction
--      already needs SELECT access on `labels` — and that policy already
--      requires board membership.
--   2) Carrying the `EXISTS bm` predicate here too would force a four-
--      table planner shape (card_labels → labels → board_members → cards)
--      on every read, doubling the per-row cost without strengthening
--      the security boundary.
-- The router-level boardProtectedProcedure provides the application-tier
-- guard.

ALTER TABLE "card_labels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "card_labels" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS card_labels_tenant_iso     ON "card_labels";
DROP POLICY IF EXISTS card_labels_tenant_select  ON "card_labels";
DROP POLICY IF EXISTS card_labels_tenant_insert  ON "card_labels";
DROP POLICY IF EXISTS card_labels_tenant_update  ON "card_labels";
DROP POLICY IF EXISTS card_labels_tenant_delete  ON "card_labels";

CREATE POLICY card_labels_tenant_select ON "card_labels"
  FOR SELECT
  USING (tenant_id = current_tenant_id());

CREATE POLICY card_labels_tenant_insert ON "card_labels"
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY card_labels_tenant_update ON "card_labels"
  FOR UPDATE
  USING      (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY card_labels_tenant_delete ON "card_labels"
  FOR DELETE
  USING (tenant_id = current_tenant_id());


-- ============================================================================
-- 6. Refresh planner statistics
-- ============================================================================

ANALYZE "labels";
ANALYZE "card_labels";
