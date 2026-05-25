-- Migration: 0006_phase11_shell_foundation.sql
-- Phase 1.1 (F1) — Shell & Navigation: schema & RLS foundation.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS MIGRATION DOES
--
--   A. Adds UX-level columns to existing tenant tables:
--        workspaces : description, visibility, background_data
--        boards     : description, visibility, background_data
--        users      : avatar_url, bio, preferences
--      (deleted_at on workspaces / users and archived_at + deleted_at on
--      boards already exist — this migration MUST NOT redeclare them.)
--
--   B. Creates two new tables:
--        user_board_metadata    — per-user star + last-viewed bookkeeping.
--        workspace_invitations  — token-based invite flow with 7-day default
--                                 expiry.
--
--   C. Adds RLS to both new tables, split per command (SELECT / INSERT /
--      UPDATE / DELETE) following the pattern established in migration
--      0004_rls_split_policies.sql. No FOR ALL policies. No silent UPDATE
--      tenant rewrites.
--
--   D. Defensive CHECK constraints on every new JSONB column to enforce that
--      stored values are objects (or NULL where applicable). Domain-layer Zod
--      validation is the first line of defence; this is the second.
--
--   E. Validates visibility enums:
--        workspaces.visibility ∈ { 'private', 'public' }                default 'private'
--        boards.visibility     ∈ { 'workspace', 'private', 'public' }   default 'workspace'
--      The role enum used by `workspace_invitations.role` is intentionally
--      NARROWER than `workspace_members.role`:
--        invitations.role ∈ { 'ADMIN', 'MEMBER', 'VIEWER' }
--      'OWNER' is excluded — ownership is transferred via a separate flow,
--      never invited. The Persian UI label for VIEWER is "ناظر".
--      ⚠ Keep these in sync with packages/domain/src/workspaces/index.ts
--        (WORKSPACE_ROLES) and the workspace_members CHECK from 0003.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- IDEMPOTENCY
--
--   Every ALTER / CREATE statement is guarded by IF NOT EXISTS or wrapped in
--   a DO block that probes information_schema first. Re-running this
--   migration on an already-migrated database is a no-op.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- D2 NOTE — DELETE policy on workspace_invitations
--
--   The original spec called for "no DELETE policy" (append-only revocation).
--   In practice, FK ON DELETE CASCADE from workspaces.id under FORCE ROW
--   LEVEL SECURITY requires app_user to satisfy a DELETE policy on the
--   referencing table — otherwise the cascade fails with
--   "permission denied for table workspace_invitations".
--
--   Resolution (approved): permit DELETE ONLY for admin/owner of the parent
--   workspace, with tenant_id = current_tenant_id(). Routine revocation
--   continues to use the `revoked_at` flag; hard DELETE happens only as a
--   side-effect of workspace hard-deletion (the ≥30-day janitor job).
-- ─────────────────────────────────────────────────────────────────────────────


-- ============================================================================
-- 1. workspaces — UX columns + visibility CHECK + JSONB shape CHECK
-- ============================================================================

ALTER TABLE "workspaces"
  ADD COLUMN IF NOT EXISTS "description"     text,
  ADD COLUMN IF NOT EXISTS "visibility"      varchar(10) NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS "background_data" jsonb;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "workspaces"
    WHERE "visibility" NOT IN ('private', 'public')
  ) THEN
    RAISE EXCEPTION
      'Migration 0006 aborted: workspaces.visibility contains values outside { private, public }.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'workspaces_visibility_check'
      AND table_name      = 'workspaces'
  ) THEN
    EXECUTE 'ALTER TABLE "workspaces" DROP CONSTRAINT "workspaces_visibility_check"';
  END IF;

  EXECUTE
    'ALTER TABLE "workspaces" '
    'ADD CONSTRAINT "workspaces_visibility_check" '
    'CHECK ("visibility" IN (''private'', ''public''))';

  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'workspaces_background_data_object_check'
      AND table_name      = 'workspaces'
  ) THEN
    EXECUTE 'ALTER TABLE "workspaces" DROP CONSTRAINT "workspaces_background_data_object_check"';
  END IF;

  EXECUTE
    'ALTER TABLE "workspaces" '
    'ADD CONSTRAINT "workspaces_background_data_object_check" '
    'CHECK ("background_data" IS NULL OR jsonb_typeof("background_data") = ''object'')';
END$$;


-- ============================================================================
-- 2. boards — UX columns + visibility CHECK + JSONB shape CHECK
-- ============================================================================

ALTER TABLE "boards"
  ADD COLUMN IF NOT EXISTS "description"     text,
  ADD COLUMN IF NOT EXISTS "visibility"      varchar(10) NOT NULL DEFAULT 'workspace',
  ADD COLUMN IF NOT EXISTS "background_data" jsonb;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "boards"
    WHERE "visibility" NOT IN ('workspace', 'private', 'public')
  ) THEN
    RAISE EXCEPTION
      'Migration 0006 aborted: boards.visibility contains values outside { workspace, private, public }.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'boards_visibility_check'
      AND table_name      = 'boards'
  ) THEN
    EXECUTE 'ALTER TABLE "boards" DROP CONSTRAINT "boards_visibility_check"';
  END IF;

  EXECUTE
    'ALTER TABLE "boards" '
    'ADD CONSTRAINT "boards_visibility_check" '
    'CHECK ("visibility" IN (''workspace'', ''private'', ''public''))';

  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'boards_background_data_object_check'
      AND table_name      = 'boards'
  ) THEN
    EXECUTE 'ALTER TABLE "boards" DROP CONSTRAINT "boards_background_data_object_check"';
  END IF;

  EXECUTE
    'ALTER TABLE "boards" '
    'ADD CONSTRAINT "boards_background_data_object_check" '
    'CHECK ("background_data" IS NULL OR jsonb_typeof("background_data") = ''object'')';
END$$;


-- ============================================================================
-- 3. users — profile columns + preferences JSONB shape CHECK
-- ============================================================================
-- NOTE: `preferences` is NOT NULL DEFAULT '{}'::jsonb so existing rows are
-- backfilled in the same statement. The CHECK ensures it stays an object.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "avatar_url"  text,
  ADD COLUMN IF NOT EXISTS "bio"         text,
  ADD COLUMN IF NOT EXISTS "preferences" jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "users"
    WHERE jsonb_typeof("preferences") <> 'object'
  ) THEN
    RAISE EXCEPTION
      'Migration 0006 aborted: users.preferences contains non-object values; clean before re-running.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'users_preferences_object_check'
      AND table_name      = 'users'
  ) THEN
    EXECUTE 'ALTER TABLE "users" DROP CONSTRAINT "users_preferences_object_check"';
  END IF;

  EXECUTE
    'ALTER TABLE "users" '
    'ADD CONSTRAINT "users_preferences_object_check" '
    'CHECK (jsonb_typeof("preferences") = ''object'')';
END$$;


-- ============================================================================
-- 4. user_board_metadata — Star + Recently Viewed bookkeeping
-- ============================================================================
-- Composite PK (user_id, board_id) keeps the table at most one row per
-- (user, board). Both is_starred and last_viewed_at live on the same row so
-- the sidebar bootstrap query can fetch both with a single index scan.
--
-- tenant_id is denormalised onto this row because:
--   (a) RLS on per-user tables benefits from the same `current_tenant_id()`
--       comparison that every other tenant table uses; an extra JOIN to
--       boards inside the policy would be measurably slower.
--   (b) ON DELETE CASCADE from boards already keeps tenant_id consistent —
--       a board cannot move tenants, so the denormalisation never goes
--       stale.

CREATE TABLE IF NOT EXISTS "user_board_metadata" (
  "user_id"        uuid        NOT NULL REFERENCES "users"("id")      ON DELETE CASCADE,
  "board_id"       uuid        NOT NULL REFERENCES "boards"("id")     ON DELETE CASCADE,
  "tenant_id"      uuid        NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "is_starred"     boolean     NOT NULL DEFAULT false,
  "last_viewed_at" timestamptz,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "user_board_metadata_pkey" PRIMARY KEY ("user_id", "board_id")
);

-- Sidebar "Starred" lookup — tiny partial index for the common case.
CREATE INDEX IF NOT EXISTS "idx_ubm_user_starred"
  ON "user_board_metadata" ("user_id")
  WHERE "is_starred" = true;

-- Sidebar "Recent" lookup — 5 most recent boards for a user, in DESC order.
CREATE INDEX IF NOT EXISTS "idx_ubm_user_last_viewed"
  ON "user_board_metadata" ("user_id", "last_viewed_at" DESC)
  WHERE "last_viewed_at" IS NOT NULL;

-- Tenant scan path (used by the RLS policy and per-tenant cleanup).
CREATE INDEX IF NOT EXISTS "idx_ubm_tenant"
  ON "user_board_metadata" ("tenant_id");


-- ============================================================================
-- 5. workspace_invitations — token-based invite flow
-- ============================================================================
-- Invariants:
--   - role ∈ { ADMIN, MEMBER, VIEWER } — narrower than workspace_members
--     (no OWNER); ownership transfer is a separate flow.
--   - invited_email is enforced to be lowercase via CHECK; the partial unique
--     index uses lower() defensively.
--   - At most ONE active invitation per (lower(invited_email), workspace_id)
--     where active := accepted_at IS NULL AND revoked_at IS NULL.
--   - tenant_id is denormalised (= workspace_id) for RLS uniformity.
--   - invited_by_user_id ON DELETE RESTRICT — invitation history must not
--     be silently destroyed; deleting a user that issued invitations is a
--     deliberate workflow (revoke first, then delete).
--   - invited_user_id / accepted_by_user_id / revoked_by_user_id are
--     ON DELETE SET NULL — they are informational, not blocking.

CREATE TABLE IF NOT EXISTS "workspace_invitations" (
  "id"                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid          NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "workspace_id"          uuid          NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "invited_email"         varchar(254)  NOT NULL,
  "invited_user_id"       uuid          REFERENCES "users"("id") ON DELETE SET NULL,
  "invited_by_user_id"    uuid          NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "role"                  varchar(20)   NOT NULL,
  "token"                 varchar(64)   NOT NULL,
  "expires_at"            timestamptz   NOT NULL,
  "accepted_at"           timestamptz,
  "accepted_by_user_id"   uuid          REFERENCES "users"("id") ON DELETE SET NULL,
  "revoked_at"            timestamptz,
  "revoked_by_user_id"    uuid          REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at"            timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT "workspace_invitations_role_check"
    CHECK ("role" IN ('ADMIN', 'MEMBER', 'VIEWER')),
  CONSTRAINT "workspace_invitations_email_lowercase_check"
    CHECK ("invited_email" = lower("invited_email")),
  -- tenant_id MUST equal workspace_id — they are the same concept on this
  -- table; the duplicate column exists only so the RLS predicate matches the
  -- shape used elsewhere.
  CONSTRAINT "workspace_invitations_tenant_eq_workspace_check"
    CHECK ("tenant_id" = "workspace_id"),
  -- Lifecycle invariant: a row is either pending, accepted, or revoked —
  -- never both accepted and revoked.
  CONSTRAINT "workspace_invitations_lifecycle_check"
    CHECK (NOT ("accepted_at" IS NOT NULL AND "revoked_at" IS NOT NULL))
);

-- Token lookup path (accept-by-token endpoint). Token is unguessable
-- (>=384 bits of entropy from the application layer).
CREATE UNIQUE INDEX IF NOT EXISTS "idx_invitations_token_unique"
  ON "workspace_invitations" ("token");

-- One active invitation per (email, workspace).
CREATE UNIQUE INDEX IF NOT EXISTS "idx_invitations_active_email_workspace_unique"
  ON "workspace_invitations" (lower("invited_email"), "workspace_id")
  WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;

-- Pending invitations of a workspace — the Members page query path.
CREATE INDEX IF NOT EXISTS "idx_invitations_pending_workspace"
  ON "workspace_invitations" ("workspace_id")
  WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;

-- Cross-workspace lookup by email — used when a user with N pending
-- invitations logs in.
CREATE INDEX IF NOT EXISTS "idx_invitations_email"
  ON "workspace_invitations" (lower("invited_email"))
  WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;

-- Tenant scan path (defensive — same reason as user_board_metadata).
CREATE INDEX IF NOT EXISTS "idx_invitations_tenant"
  ON "workspace_invitations" ("tenant_id");


-- ============================================================================
-- 6. RLS — user_board_metadata (per-user + per-tenant)
-- ============================================================================
-- A row is visible iff it is owned by the current user AND scoped to the
-- current tenant. Both predicates are required: a malicious request that
-- somehow forges one GUC must still trip the other.

ALTER TABLE "user_board_metadata" ENABLE  ROW LEVEL SECURITY;
ALTER TABLE "user_board_metadata" FORCE   ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_board_metadata_self_select ON "user_board_metadata";
DROP POLICY IF EXISTS user_board_metadata_self_insert ON "user_board_metadata";
DROP POLICY IF EXISTS user_board_metadata_self_update ON "user_board_metadata";
DROP POLICY IF EXISTS user_board_metadata_self_delete ON "user_board_metadata";

CREATE POLICY user_board_metadata_self_select ON "user_board_metadata"
  FOR SELECT
  USING (
    "user_id"   = app.current_user_id()
    AND "tenant_id" = current_tenant_id()
  );

CREATE POLICY user_board_metadata_self_insert ON "user_board_metadata"
  FOR INSERT
  WITH CHECK (
    "user_id"   = app.current_user_id()
    AND "tenant_id" = current_tenant_id()
  );

CREATE POLICY user_board_metadata_self_update ON "user_board_metadata"
  FOR UPDATE
  USING (
    "user_id"   = app.current_user_id()
    AND "tenant_id" = current_tenant_id()
  )
  WITH CHECK (
    "user_id"   = app.current_user_id()
    AND "tenant_id" = current_tenant_id()
  );

CREATE POLICY user_board_metadata_self_delete ON "user_board_metadata"
  FOR DELETE
  USING (
    "user_id"   = app.current_user_id()
    AND "tenant_id" = current_tenant_id()
  );


-- ============================================================================
-- 7. RLS — workspace_invitations (admin/owner OR invitee visibility)
-- ============================================================================
-- SELECT:
--   • tenant_id always matches current_tenant_id() (cheap pre-filter).
--   • AND one of:
--       (a) caller is an ADMIN/OWNER of the workspace (workspace_members
--           lookup), OR
--       (b) caller is the invited user by user_id, OR
--       (c) caller's email_normalized matches lower(invited_email)
--           AND the invitation is still pending.
--   The accept-by-token endpoint that runs BEFORE the user is a member
--   uses a BYPASSRLS service role; this policy intentionally does not let
--   "anyone with a guessed token" read invitation rows.
--
-- INSERT / UPDATE: only ADMIN/OWNER of the workspace.
-- DELETE         : only ADMIN/OWNER of the workspace (D2 — required for
--                  CASCADE under FORCE RLS during workspace hard-delete).

ALTER TABLE "workspace_invitations" ENABLE  ROW LEVEL SECURITY;
ALTER TABLE "workspace_invitations" FORCE   ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_invitations_visibility_select ON "workspace_invitations";
DROP POLICY IF EXISTS workspace_invitations_admin_insert      ON "workspace_invitations";
DROP POLICY IF EXISTS workspace_invitations_admin_update      ON "workspace_invitations";
DROP POLICY IF EXISTS workspace_invitations_admin_delete      ON "workspace_invitations";

CREATE POLICY workspace_invitations_visibility_select ON "workspace_invitations"
  FOR SELECT
  USING (
    "tenant_id" = current_tenant_id()
    AND (
      -- (a) admin/owner of the workspace
      EXISTS (
        SELECT 1 FROM "workspace_members" wm
        WHERE wm."workspace_id" = "workspace_invitations"."workspace_id"
          AND wm."user_id"      = app.current_user_id()
          AND wm."role" IN ('OWNER', 'ADMIN')
      )
      OR
      -- (b) invited user by id
      "invited_user_id" = app.current_user_id()
      OR
      -- (c) invited user by email (still pending)
      (
        "accepted_at" IS NULL
        AND "revoked_at" IS NULL
        AND EXISTS (
          SELECT 1 FROM "users" u
          WHERE u."id" = app.current_user_id()
            AND u."email_normalized" = lower("workspace_invitations"."invited_email")
            AND u."deleted_at" IS NULL
        )
      )
    )
  );

CREATE POLICY workspace_invitations_admin_insert ON "workspace_invitations"
  FOR INSERT
  WITH CHECK (
    "tenant_id" = current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspace_id" = "workspace_invitations"."workspace_id"
        AND wm."user_id"      = app.current_user_id()
        AND wm."role" IN ('OWNER', 'ADMIN')
    )
  );

CREATE POLICY workspace_invitations_admin_update ON "workspace_invitations"
  FOR UPDATE
  USING (
    "tenant_id" = current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspace_id" = "workspace_invitations"."workspace_id"
        AND wm."user_id"      = app.current_user_id()
        AND wm."role" IN ('OWNER', 'ADMIN')
    )
  )
  WITH CHECK (
    "tenant_id" = current_tenant_id()
  );

-- D2 — required for FK CASCADE from workspaces to succeed under FORCE RLS.
-- Routine revocation MUST go through revoked_at; this DELETE policy exists
-- ONLY so that hard-delete of a workspace by its admin/owner can cascade.
CREATE POLICY workspace_invitations_admin_delete ON "workspace_invitations"
  FOR DELETE
  USING (
    "tenant_id" = current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspace_id" = "workspace_invitations"."workspace_id"
        AND wm."user_id"      = app.current_user_id()
        AND wm."role" IN ('OWNER', 'ADMIN')
    )
  );


-- ============================================================================
-- 8. GRANTs — app_user
-- ============================================================================
-- app_worker / app_service / app_migration already inherit DML on every
-- public table via the DEFAULT PRIVILEGES set up in 0004. We only need to
-- explicitly grant to app_user.

GRANT SELECT, INSERT, UPDATE, DELETE ON "user_board_metadata"   TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "workspace_invitations" TO app_user;


-- ============================================================================
-- 9. Refresh statistics
-- ============================================================================

ANALYZE "workspaces";
ANALYZE "boards";
ANALYZE "users";
ANALYZE "user_board_metadata";
ANALYZE "workspace_invitations";
