-- Migration: 0017_outbox_tenant_rls.sql
-- Phase 1.4 (H-04 / A-02) — give outbox_events a first-class tenant_id column
-- and bring it under the same three-layer tenant-isolation regime as the rest
-- of the schema (rls-rules.md: "ENABLE + FORCE ROW LEVEL SECURITY on every
-- tenant table").
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY
--   outbox_events carries the full payload of every mutation (card/board
--   content) for each tenant, and the activity feed (activity.router) reads
--   straight from it. Until now isolation relied ONLY on the application layer
--   (boardProtectedProcedure membership check + a `payload->>'boardId'` filter)
--   — RLS (layer 3) was absent for this table. A future query that forgets the
--   boardId filter, or a membership-check regression, could leak cross-tenant
--   outbox rows. This migration restores defense-in-depth.
--
-- HOW
--   1. Add nullable tenant_id (so existing append() writers keep working).
--   2. Backfill from the owning board/card/list.
--   3. A BEFORE INSERT trigger auto-derives tenant_id for future inserts that
--      don't set it explicitly (covers both the API and the rebalance worker).
--   4. ENABLE + FORCE RLS with split per-operation policies (mirrors
--      0004_rls_split_policies.sql). The outbox worker connects as the
--      BYPASSRLS `app_service` role, so its cross-tenant publish loop is
--      unaffected; only `app_user` reads (the activity feed) are constrained.
--
-- ASSUMPTION
--   Migrations run as a superuser / privileged owner (0002 creates roles, which
--   requires it), so the backfill joins below see all rows regardless of the
--   FORCE RLS on boards/cards/lists.
--
-- IDEMPOTENCY: IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS throughout.
-- ─────────────────────────────────────────────────────────────────────────────


-- ============================================================================
-- 1. Column
-- ============================================================================
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;


-- ============================================================================
-- 2. Backfill from the owning aggregate
-- ============================================================================
-- Resolve tenant via boards first (board-aggregate events + any event whose
-- payload carries boardId), then cards, then lists. Each pass only touches
-- rows still NULL so the order is a widening fallback.

UPDATE "outbox_events" o
SET tenant_id = b.tenant_id
FROM public.boards b
WHERE o.tenant_id IS NULL
  AND b.id = COALESCE(
    NULLIF(o.payload->>'boardId', '')::uuid,
    CASE WHEN o.aggregate_type = 'board' THEN o.aggregate_id END
  );

UPDATE "outbox_events" o
SET tenant_id = c.tenant_id
FROM public.cards c
WHERE o.tenant_id IS NULL
  AND c.id = COALESCE(
    NULLIF(o.payload->>'cardId', '')::uuid,
    CASE WHEN o.aggregate_type = 'card' THEN o.aggregate_id END
  );

UPDATE "outbox_events" o
SET tenant_id = l.tenant_id
FROM public.lists l
WHERE o.tenant_id IS NULL
  AND l.id = COALESCE(
    NULLIF(o.payload->>'listId', '')::uuid,
    CASE WHEN o.aggregate_type = 'list' THEN o.aggregate_id END
  );


-- ============================================================================
-- 3. Auto-populate trigger for future inserts
-- ============================================================================
-- Writers (DrizzleOutboxRepository.append and the rebalance worker's raw
-- INSERT) do not set tenant_id explicitly. This trigger derives it so the
-- column stays populated without threading tenantId through every call site.
-- SECURITY INVOKER (default): for app_user inserts the lookups run with the
-- request GUC set, so they resolve the correct (own) tenant; for the BYPASSRLS
-- worker the lookups see all rows.

CREATE OR REPLACE FUNCTION app.outbox_set_tenant_id() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := COALESCE(
      NULLIF(NEW.payload->>'tenantId', '')::uuid,
      (SELECT b.tenant_id FROM public.boards b
        WHERE b.id = COALESCE(
          NULLIF(NEW.payload->>'boardId', '')::uuid,
          CASE WHEN NEW.aggregate_type = 'board' THEN NEW.aggregate_id END
        )),
      (SELECT c.tenant_id FROM public.cards c
        WHERE c.id = COALESCE(
          NULLIF(NEW.payload->>'cardId', '')::uuid,
          CASE WHEN NEW.aggregate_type = 'card' THEN NEW.aggregate_id END
        )),
      (SELECT l.tenant_id FROM public.lists l
        WHERE l.id = COALESCE(
          NULLIF(NEW.payload->>'listId', '')::uuid,
          CASE WHEN NEW.aggregate_type = 'list' THEN NEW.aggregate_id END
        ))
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS outbox_set_tenant_id_trg ON "outbox_events";
CREATE TRIGGER outbox_set_tenant_id_trg
  BEFORE INSERT ON "outbox_events"
  FOR EACH ROW EXECUTE FUNCTION app.outbox_set_tenant_id();


-- ============================================================================
-- 4. Index for tenant-scoped reads
-- ============================================================================
CREATE INDEX IF NOT EXISTS "outbox_tenant_idx"
  ON "outbox_events" ("tenant_id");

-- Composite index leading with tenant_id for the card activity feed, now that
-- the filter can include tenant_id (supersedes the 0016 card index for the
-- tenant-scoped query path; the 0016 indexes are kept as a fallback).
CREATE INDEX IF NOT EXISTS "idx_outbox_tenant_card_activity"
  ON "outbox_events" ("tenant_id", (payload->>'cardId'), "occurred_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_outbox_tenant_board_activity"
  ON "outbox_events" ("tenant_id", (payload->>'boardId'), "occurred_at" DESC);


-- ============================================================================
-- 5. Row Level Security (split per-operation policies, mirrors 0004)
-- ============================================================================
ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_events" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outbox_tenant_select ON "outbox_events";
DROP POLICY IF EXISTS outbox_tenant_insert ON "outbox_events";
DROP POLICY IF EXISTS outbox_tenant_update ON "outbox_events";
DROP POLICY IF EXISTS outbox_tenant_delete ON "outbox_events";

CREATE POLICY outbox_tenant_select ON "outbox_events"
  FOR SELECT
  USING (tenant_id = current_tenant_id());
CREATE POLICY outbox_tenant_insert ON "outbox_events"
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY outbox_tenant_update ON "outbox_events"
  FOR UPDATE
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY outbox_tenant_delete ON "outbox_events"
  FOR DELETE
  USING (tenant_id = current_tenant_id());


-- ============================================================================
-- 6. Refresh statistics
-- ============================================================================
ANALYZE "outbox_events";
