-- Migration: 0014_phase1.2_notifications.sql
-- Phase 1.2 (F1.2.9) — Watch + Notifications (Inbox).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS MIGRATION DOES
--
--   A. Defines the `current_user_id()` SQL helper that reads the
--      `app.current_user_id` GUC (set by db/middleware/tenantContext.ts and
--      trpc.ts runInTenantTx). The `notifications` RLS policies need a
--      per-USER predicate, not just per-tenant, so this helper mirrors the
--      existing `current_tenant_id()` from rls/tenantPolicies.sql.
--
--   B. Creates `card_watchers` — a (card_id, user_id) junction recording
--      which users want notifications for a card. tenant_id denormalised for
--      RLS without JOIN (same rationale as card_assignees / checklist_items).
--      Tenant-only RLS — watchers are reachable only through cards which
--      already enforce board membership.
--
--   C. Creates `notifications` — a first-class inbox row per recipient.
--      RLS is USER + TENANT scoped: a user may only see / mutate their own
--      notifications. The outbox-worker writes notifications under a
--      BYPASSRLS service role (app_service), so the per-user INSERT predicate
--      never blocks fan-out.
--
--   D. Adds `users.email_notifications_enabled boolean NOT NULL DEFAULT true`
--      — the opt-out flag the outbox-worker checks before sending email.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- USER-REFERENCE COLUMN TYPE
--   user_id / actor_id are varchar(128) (the text form of the uuid), matching
--   comments.author_id and attachments.uploaded_by. No cross-type FK to
--   users(id uuid) — PostgreSQL cannot build a uuid <-> varchar foreign key,
--   so (like attachments) we omit the FK and rely on application + RLS.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- IDEMPOTENCY
--   CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
--   CREATE INDEX IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE POLICY,
--   CREATE OR REPLACE FUNCTION. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE
    '[migration 0014] Phase 1.2 F1.2.9 — current_user_id() helper, card_watchers '
    'junction, notifications inbox table (user+tenant RLS), and '
    'users.email_notifications_enabled opt-out flag.';
END$$;


-- ============================================================================
-- 0. current_user_id() — GUC reader for per-user RLS
-- ============================================================================
-- Returns the current request's user id as text (the GUC stores the uuid in
-- its text form). NULLIF maps the empty default to NULL so an unset GUC
-- fails closed (no row matches `user_id = NULL`).

CREATE OR REPLACE FUNCTION current_user_id() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT NULLIF(current_setting('app.current_user_id', true), '');
  $$;


-- ============================================================================
-- 1. card_watchers table
-- ============================================================================

CREATE TABLE IF NOT EXISTS "card_watchers" (
  "card_id"    uuid         NOT NULL REFERENCES "cards"("id") ON DELETE CASCADE,
  "user_id"    varchar(128) NOT NULL,
  "tenant_id"  uuid         NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),

  PRIMARY KEY ("card_id", "user_id")
);

-- Reverse lookup — "cards I watch" + the RLS tenant predicate.
CREATE INDEX IF NOT EXISTS "idx_card_watchers_user"
  ON "card_watchers" ("user_id", "tenant_id");

-- Fan-out lookup — "who watches this card" (worker reads by card_id).
CREATE INDEX IF NOT EXISTS "idx_card_watchers_card"
  ON "card_watchers" ("card_id", "tenant_id");


-- ============================================================================
-- 2. card_watchers — Row Level Security (tenant-only, split per-command)
-- ============================================================================

ALTER TABLE "card_watchers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "card_watchers" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS card_watchers_tenant_select ON "card_watchers";
DROP POLICY IF EXISTS card_watchers_tenant_insert ON "card_watchers";
DROP POLICY IF EXISTS card_watchers_tenant_update ON "card_watchers";
DROP POLICY IF EXISTS card_watchers_tenant_delete ON "card_watchers";

CREATE POLICY card_watchers_tenant_select ON "card_watchers"
  FOR SELECT USING (tenant_id = current_tenant_id());

CREATE POLICY card_watchers_tenant_insert ON "card_watchers"
  FOR INSERT WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY card_watchers_tenant_update ON "card_watchers"
  FOR UPDATE
  USING      (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY card_watchers_tenant_delete ON "card_watchers"
  FOR DELETE USING (tenant_id = current_tenant_id());


-- ============================================================================
-- 3. notifications table
-- ============================================================================

CREATE TABLE IF NOT EXISTS "notifications" (
  "id"          uuid         PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"   uuid         NOT NULL,
  -- recipient (varchar(128) — text form of the user uuid, no cross-type FK)
  "user_id"     varchar(128) NOT NULL,
  "type"        varchar(64)  NOT NULL,
  "entity_type" varchar(32)  NOT NULL DEFAULT 'card',
  "entity_id"   uuid         NOT NULL,
  "board_id"    uuid,
  "card_id"     uuid,
  "actor_id"    varchar(128) NOT NULL,
  "actor_name"  varchar(255),
  "title"       varchar(255) NOT NULL,
  "body"        text,
  "read_at"     timestamp with time zone,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now()
);

-- Unread inbox count + unread list (partial index keeps it small + hot).
CREATE INDEX IF NOT EXISTS "idx_notifications_unread"
  ON "notifications" ("user_id", "tenant_id", "created_at" DESC)
  WHERE "read_at" IS NULL;

-- Full inbox listing (cursor pagination, newest-first).
CREATE INDEX IF NOT EXISTS "idx_notifications_all"
  ON "notifications" ("user_id", "tenant_id", "created_at" DESC);


-- ============================================================================
-- 4. notifications — Row Level Security (USER + TENANT, split per-command)
-- ============================================================================
-- A user may only read / mutate their OWN notifications. INSERT is performed
-- by the outbox-worker under a BYPASSRLS service role, so the INSERT policy
-- is tenant-only (it never gates the worker, and lets an admin tool insert
-- within-tenant if ever needed).

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_user_select ON "notifications";
DROP POLICY IF EXISTS notifications_tenant_insert ON "notifications";
DROP POLICY IF EXISTS notifications_user_update ON "notifications";
DROP POLICY IF EXISTS notifications_user_delete ON "notifications";

CREATE POLICY notifications_user_select ON "notifications"
  FOR SELECT
  USING (tenant_id = current_tenant_id() AND user_id = current_user_id());

CREATE POLICY notifications_tenant_insert ON "notifications"
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY notifications_user_update ON "notifications"
  FOR UPDATE
  USING      (tenant_id = current_tenant_id() AND user_id = current_user_id())
  WITH CHECK (tenant_id = current_tenant_id() AND user_id = current_user_id());

CREATE POLICY notifications_user_delete ON "notifications"
  FOR DELETE
  USING (tenant_id = current_tenant_id() AND user_id = current_user_id());


-- ============================================================================
-- 5. users.email_notifications_enabled — opt-out flag
-- ============================================================================

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "email_notifications_enabled" boolean NOT NULL DEFAULT true;


-- ============================================================================
-- 6. Refresh planner statistics
-- ============================================================================

ANALYZE "card_watchers";
ANALYZE "notifications";
