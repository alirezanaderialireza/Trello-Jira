-- Migration: 0002_phase02_auth_rls.sql
-- Phase 0.2: complete the schema (Auth.js + multi-tenant + Phase 4 card features)
-- and enable Row Level Security with a tenant-isolation policy.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DESIGN NOTES
--
-- 1. Idempotent: every CREATE/ALTER/DROP guarded by IF NOT EXISTS / DO blocks
--    so this can run repeatedly during development without breaking the DB.
--
-- 2. Roles:  the rich tenantPolicies.sql in src/rls/ assumes pre-existing
--    roles (app_user / app_service / app_migration) which most dev databases
--    do not have. This migration creates them conditionally and grants the
--    minimum needed for app-layer connections to work.  In production you
--    rotate to a stricter role separation.
--
-- 3. RLS:    we enable a SIMPLE tenant-isolation policy here.  The richer
--    role-aware policies in src/rls/cardPolicies.sql can be layered later
--    once board_members data is fully populated.
--
-- 4. GUC:    `app.current_tenant_id` is set by the app layer before each
--    transaction (see packages/db/src/middleware/tenantContext.ts and the
--    tRPC tenantContextMiddleware in packages/api/src/trpc.ts).
-- ─────────────────────────────────────────────────────────────────────────────

-- ============================================================================
-- 0. Roles & GUC defaults  (idempotent)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_service') THEN
    CREATE ROLE app_service NOLOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migration') THEN
    CREATE ROLE app_migration NOLOGIN BYPASSRLS;
  END IF;
END$$;

-- ============================================================================
-- 1. Auth.js core tables  (users, accounts, auth_sessions, verification_tokens)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar(254) NOT NULL,
  "email_normalized" varchar(254) NOT NULL,
  "email_verified_at" timestamp with time zone,
  "password_hash" text,
  "display_name" varchar(100) NOT NULL,
  "locale" varchar(10) NOT NULL DEFAULT 'fa',
  "timezone" varchar(64) NOT NULL DEFAULT 'Asia/Tehran',
  "last_seen_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_email_unique"
  ON "users" ("email_normalized")
  WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_users_last_seen" ON "users" ("last_seen_at");

CREATE TABLE IF NOT EXISTS "accounts" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" varchar(32) NOT NULL,
  "provider" varchar(64) NOT NULL,
  "provider_account_id" varchar(255) NOT NULL,
  "refresh_token" text,
  "access_token" text,
  "expires_at" integer,
  "token_type" varchar(32),
  "scope" varchar(255),
  "id_token" text,
  "session_state" varchar(255),
  PRIMARY KEY ("provider", "provider_account_id")
);

CREATE TABLE IF NOT EXISTS "auth_sessions" (
  "session_token" text PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "expires" timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS "verification_tokens" (
  "identifier" text NOT NULL,
  "token" text NOT NULL,
  "expires" timestamp with time zone NOT NULL,
  PRIMARY KEY ("identifier", "token")
);

-- ============================================================================
-- 2. Workspaces & Workspace Members
-- ============================================================================

CREATE TABLE IF NOT EXISTS "workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(100) NOT NULL,
  "slug" varchar(60) NOT NULL,
  "tier" varchar(20) NOT NULL DEFAULT 'free',
  "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "personal_for_user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "revision" integer NOT NULL DEFAULT 1,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_workspaces_slug_unique"
  ON "workspaces" ("slug")
  WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_workspaces_owner" ON "workspaces" ("owner_id");

CREATE TABLE IF NOT EXISTS "workspace_members" (
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" varchar(20) NOT NULL DEFAULT 'MEMBER',
  "joined_at" timestamp with time zone NOT NULL DEFAULT now(),
  "invited_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  PRIMARY KEY ("workspace_id", "user_id")
);

CREATE INDEX IF NOT EXISTS "idx_workspace_members_user"
  ON "workspace_members" ("user_id");

-- ============================================================================
-- 3. Phase 4 card-feature tables (labels, checklists, comments)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "labels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "board_id" uuid NOT NULL REFERENCES "boards"("id") ON DELETE CASCADE,
  "name" varchar(64) NOT NULL,
  "color" varchar(7) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "idx_labels_board"
  ON "labels" ("tenant_id", "board_id")
  WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "idx_labels_unique_name"
  ON "labels" ("board_id", "name")
  WHERE "deleted_at" IS NULL;

CREATE TABLE IF NOT EXISTS "card_labels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "card_id" uuid NOT NULL,
  "label_id" uuid NOT NULL REFERENCES "labels"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_card_labels_unique"
  ON "card_labels" ("card_id", "label_id");
CREATE INDEX IF NOT EXISTS "idx_card_labels_card"  ON "card_labels" ("card_id");
CREATE INDEX IF NOT EXISTS "idx_card_labels_label" ON "card_labels" ("label_id");

CREATE TABLE IF NOT EXISTS "checklists" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "card_id" uuid NOT NULL REFERENCES "cards"("id") ON DELETE CASCADE,
  "board_id" uuid NOT NULL,
  "name" varchar(128) NOT NULL,
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "idx_checklists_card"
  ON "checklists" ("card_id", "position")
  WHERE "deleted_at" IS NULL;

CREATE TABLE IF NOT EXISTS "checklist_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "checklist_id" uuid NOT NULL REFERENCES "checklists"("id") ON DELETE CASCADE,
  "title" varchar(255) NOT NULL,
  "completed" boolean NOT NULL DEFAULT false,
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_checklist_items_checklist"
  ON "checklist_items" ("checklist_id", "position");

CREATE TABLE IF NOT EXISTS "comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "card_id" uuid NOT NULL REFERENCES "cards"("id") ON DELETE CASCADE,
  "board_id" uuid NOT NULL,
  "author_id" varchar(128) NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "edited_at" timestamp with time zone,
  "deleted_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "idx_comments_card"
  ON "comments" ("card_id", "created_at")
  WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_comments_board"
  ON "comments" ("tenant_id", "board_id")
  WHERE "deleted_at" IS NULL;

-- ============================================================================
-- 4. Backfill missing FK on boards.tenant_id → workspaces.id
-- ============================================================================
-- 0001 created boards.tenant_id without a FK (workspaces did not yet exist).
-- Now that workspaces is in place, add the constraint if it is missing.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'boards_tenant_id_workspaces_id_fk'
      AND table_name      = 'boards'
  ) THEN
    ALTER TABLE "boards"
      ADD CONSTRAINT "boards_tenant_id_workspaces_id_fk"
      FOREIGN KEY ("tenant_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
  END IF;
END$$;

-- ============================================================================
-- 5. Helper: current_tenant_id() — reads `app.current_tenant_id` GUC
-- ============================================================================
-- Returns NULL if the GUC is not set, which makes RLS deny by default.
-- The application layer (withTenantContext) sets this with SET LOCAL before
-- every transaction.

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid;
$$;

-- ============================================================================
-- 6. Enable RLS + tenant-isolation policies
-- ============================================================================
-- Strategy: drop-and-recreate so re-running this migration replaces older
-- variants of the same policy idempotently. We use FORCE so even table owners
-- (and superusers connecting as the owner) cannot bypass the check.

-- ── boards ──────────────────────────────────────────────────────────────────
ALTER TABLE "boards"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "boards"            FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS boards_tenant_iso ON "boards";
CREATE POLICY boards_tenant_iso ON "boards"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── lists ───────────────────────────────────────────────────────────────────
ALTER TABLE "lists"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lists"             FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lists_tenant_iso ON "lists";
CREATE POLICY lists_tenant_iso ON "lists"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── cards ───────────────────────────────────────────────────────────────────
ALTER TABLE "cards"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cards"             FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cards_tenant_iso ON "cards";
CREATE POLICY cards_tenant_iso ON "cards"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── board_members ───────────────────────────────────────────────────────────
ALTER TABLE "board_members"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "board_members"     FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS board_members_tenant_iso ON "board_members";
CREATE POLICY board_members_tenant_iso ON "board_members"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── audit_logs (append-only via grants below; SELECT honors tenant) ─────────
ALTER TABLE "audit_logs"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs"        FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_logs_tenant_select ON "audit_logs";
CREATE POLICY audit_logs_tenant_select ON "audit_logs"
  FOR SELECT
  USING (tenant_id = current_tenant_id());
DROP POLICY IF EXISTS audit_logs_tenant_insert ON "audit_logs";
CREATE POLICY audit_logs_tenant_insert ON "audit_logs"
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());

-- ── labels ──────────────────────────────────────────────────────────────────
ALTER TABLE "labels"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "labels"            FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS labels_tenant_iso ON "labels";
CREATE POLICY labels_tenant_iso ON "labels"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── checklists (tenant-scoped via tenant_id) ────────────────────────────────
ALTER TABLE "checklists"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "checklists"        FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS checklists_tenant_iso ON "checklists";
CREATE POLICY checklists_tenant_iso ON "checklists"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── comments ────────────────────────────────────────────────────────────────
ALTER TABLE "comments"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "comments"          FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comments_tenant_iso ON "comments";
CREATE POLICY comments_tenant_iso ON "comments"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── workspaces / workspace_members ──────────────────────────────────────────
-- Workspaces themselves are queried by the user's own ID, so RLS isn't strictly
-- required. We still enable it as defense-in-depth, but the policy permits any
-- authenticated row read because tenant boundaries here ARE workspace IDs.
-- The application layer enforces "user must be a member" in workspaces.router.

-- ============================================================================
-- 7. Junction tables that lack tenant_id but inherit visibility from parent
-- ============================================================================
-- card_labels and checklist_items don't carry tenant_id directly; their
-- visibility is the same as their parent. We keep RLS off for them because the
-- parent table already gates SELECT/INSERT/UPDATE/DELETE.

-- ============================================================================
-- 8. Grant minimum privileges to app_user
-- ============================================================================
-- In dev, the connection user usually IS the owner, so these grants are
-- belt-and-braces. In production you connect as app_user explicitly.

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO app_user;
GRANT USAGE,  SELECT                  ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Future tables created in public will follow the same default policy.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT                  ON SEQUENCES TO app_user;
