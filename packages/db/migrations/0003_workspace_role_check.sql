-- Migration: 0003_workspace_role_check.sql
-- Phase 0.2 finishing — type-safety follow-up to migration 0002.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Why this migration exists
--
-- Migration 0002 created `workspace_members` with `role varchar(20)` and no
-- value constraint. The application layer (Drizzle schema + Zod RoleSchema)
-- claims the column only ever holds one of four values, but a raw SQL insert
-- (e.g. from a future migration script, a misconfigured worker, or a
-- compromised connection) could quietly persist anything fitting in 20 chars.
--
-- This migration adds a CHECK constraint that mirrors the
-- `WorkspaceRole` enum defined in packages/domain/src/workspaces/index.ts.
-- The two MUST stay in sync: if you add a role, update both places.
--
-- It also adds a defensive CHECK on `workspaces.tier` since the application
-- only ever sets it to "free" today and the tier column drives billing logic.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Forward compatibility
--
-- Both constraints are dropped-and-recreated to make this migration
-- idempotent during development. In production they would only be added
-- once. The DROP IF EXISTS guards keep re-runs harmless.
-- ─────────────────────────────────────────────────────────────────────────────

-- ============================================================================
-- 1. workspace_members.role  ∈  {OWNER, ADMIN, MEMBER, VIEWER}
-- ============================================================================
-- Drop any pre-existing variant of the same constraint so that re-running
-- the migration during development picks up the latest value list.

DO $$
BEGIN
  -- Defensive: refuse to add the constraint if there are existing rows that
  -- would violate it. Surface the bad rows clearly rather than failing with
  -- the obscure "check constraint violated" message.
  IF EXISTS (
    SELECT 1 FROM "workspace_members"
    WHERE "role" NOT IN ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER')
  ) THEN
    RAISE EXCEPTION
      'Migration 0003 aborted: workspace_members contains role values outside the allowed enum {OWNER, ADMIN, MEMBER, VIEWER}. Inspect the table and clean up before re-running.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'workspace_members_role_check'
      AND table_name      = 'workspace_members'
  ) THEN
    EXECUTE 'ALTER TABLE "workspace_members" DROP CONSTRAINT "workspace_members_role_check"';
  END IF;

  EXECUTE
    'ALTER TABLE "workspace_members" '
    'ADD CONSTRAINT "workspace_members_role_check" '
    'CHECK ("role" IN (''OWNER'', ''ADMIN'', ''MEMBER'', ''VIEWER''))';
END$$;

-- ============================================================================
-- 2. workspaces.tier  ∈  {free, pro, enterprise}
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "workspaces"
    WHERE "tier" NOT IN ('free', 'pro', 'enterprise')
  ) THEN
    RAISE EXCEPTION
      'Migration 0003 aborted: workspaces contains tier values outside the allowed enum {free, pro, enterprise}.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'workspaces_tier_check'
      AND table_name      = 'workspaces'
  ) THEN
    EXECUTE 'ALTER TABLE "workspaces" DROP CONSTRAINT "workspaces_tier_check"';
  END IF;

  EXECUTE
    'ALTER TABLE "workspaces" '
    'ADD CONSTRAINT "workspaces_tier_check" '
    'CHECK ("tier" IN (''free'', ''pro'', ''enterprise''))';
END$$;
