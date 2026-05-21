-- Migration: 0004_rls_split_policies.sql
-- Phase 0.3 — split FOR ALL tenant-isolation policies into one policy per
-- DML operation, expose `app.current_tenant_id()` / `app.current_user_id()`
-- helpers in a dedicated `app` schema, and add an `app_worker` role for
-- future RLS-enforced background jobs.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY SPLIT THE POLICIES?
--
-- Migration 0002 created policies of the form:
--
--   CREATE POLICY boards_tenant_iso ON "boards"
--     FOR ALL
--     USING (tenant_id = current_tenant_id())
--     WITH CHECK (tenant_id = current_tenant_id());
--
-- A `FOR ALL` policy collapses USING (visibility) and WITH CHECK
-- (write-time validation) into one rule. That has a subtle bug for UPDATE:
-- USING is checked against the OLD row, WITH CHECK against the NEW row.
-- A buggy or malicious UPDATE could in principle read its own row (passes
-- USING) and rewrite tenant_id to a different tenant (passes WITH CHECK
-- only if the new tenant_id matches current_tenant_id, which it does
-- because the GUC didn't change). The end result is that with FOR ALL we
-- DO get protection from cross-tenant updates, but only by accident of how
-- USING+WITH CHECK happen to be wired in PostgreSQL — and the same is NOT
-- true for some other policy combinations.
--
-- Splitting into four explicit policies removes the surprise:
--   SELECT  → USING only (visibility filter)
--   INSERT  → WITH CHECK only (the new row must belong to the tenant)
--   UPDATE  → both USING and WITH CHECK (old AND new row must belong)
--   DELETE  → USING only (you can only delete what you can see)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- IDEMPOTENCY
--
-- Each policy DROP / CREATE pair is wrapped in DROP POLICY IF EXISTS so the
-- migration can be re-run on environments that have already received an
-- earlier draft. The role and helper-function definitions are likewise
-- guarded with IF NOT EXISTS / OR REPLACE.
-- ─────────────────────────────────────────────────────────────────────────────


-- ============================================================================
-- 1. `app` schema and helper functions
-- ============================================================================
-- The runtime policies created in 0002 reference `public.current_tenant_id()`,
-- which we keep for compatibility. We additionally publish the same
-- functions under the `app` schema so future code (and the hardened
-- policies below for card-level visibility) can use the cleaner
-- `app.current_tenant_id()` namespace.

CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
$$;

-- The helper in `public` is what the 0002-era policies still reference.
-- Make sure it exists with identical semantics (idempotent).
CREATE OR REPLACE FUNCTION public.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid;
$$;


-- ============================================================================
-- 2. `app_worker` role
-- ============================================================================
-- A NOBYPASSRLS role intended for foreground background jobs that should
-- still be RLS-enforced (outbox processor, rebalance worker once they
-- migrate to setting `app.current_tenant_id` per-job). Distinct from
-- `app_service` (which BYPASSRLS) so the two access patterns are
-- explicit at the connection-string level.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_worker') THEN
    CREATE ROLE app_worker NOLOGIN NOBYPASSRLS;
  END IF;
END$$;

GRANT USAGE ON SCHEMA public TO app_worker;
GRANT USAGE ON SCHEMA app    TO app_worker, app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO app_worker;
GRANT USAGE,  SELECT                  ON ALL SEQUENCES IN SCHEMA public TO app_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT                  ON SEQUENCES TO app_worker;


-- ============================================================================
-- 3. Split FOR ALL policies on tenant-scoped tables
-- ============================================================================
-- Drop the legacy `*_tenant_iso` policies created by 0002 and replace each
-- with four operation-specific policies. The end result is the SAME
-- visibility rule (`tenant_id = current_tenant_id()`) but expressed
-- explicitly per-operation, so a future maintainer cannot widen one
-- operation's check by accident.

-- ── boards ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS boards_tenant_iso        ON "boards";
DROP POLICY IF EXISTS boards_tenant_select     ON "boards";
DROP POLICY IF EXISTS boards_tenant_insert     ON "boards";
DROP POLICY IF EXISTS boards_tenant_update     ON "boards";
DROP POLICY IF EXISTS boards_tenant_delete     ON "boards";

CREATE POLICY boards_tenant_select ON "boards"
  FOR SELECT
  USING (tenant_id = current_tenant_id());
CREATE POLICY boards_tenant_insert ON "boards"
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY boards_tenant_update ON "boards"
  FOR UPDATE
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY boards_tenant_delete ON "boards"
  FOR DELETE
  USING (tenant_id = current_tenant_id());

-- ── lists ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS lists_tenant_iso     ON "lists";
DROP POLICY IF EXISTS lists_tenant_select  ON "lists";
DROP POLICY IF EXISTS lists_tenant_insert  ON "lists";
DROP POLICY IF EXISTS lists_tenant_update  ON "lists";
DROP POLICY IF EXISTS lists_tenant_delete  ON "lists";

CREATE POLICY lists_tenant_select ON "lists"
  FOR SELECT
  USING (tenant_id = current_tenant_id());
CREATE POLICY lists_tenant_insert ON "lists"
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY lists_tenant_update ON "lists"
  FOR UPDATE
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY lists_tenant_delete ON "lists"
  FOR DELETE
  USING (tenant_id = current_tenant_id());

-- ── cards ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS cards_tenant_iso     ON "cards";
DROP POLICY IF EXISTS cards_tenant_select  ON "cards";
DROP POLICY IF EXISTS cards_tenant_insert  ON "cards";
DROP POLICY IF EXISTS cards_tenant_update  ON "cards";
DROP POLICY IF EXISTS cards_tenant_delete  ON "cards";

CREATE POLICY cards_tenant_select ON "cards"
  FOR SELECT
  USING (tenant_id = current_tenant_id());
CREATE POLICY cards_tenant_insert ON "cards"
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY cards_tenant_update ON "cards"
  FOR UPDATE
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY cards_tenant_delete ON "cards"
  FOR DELETE
  USING (tenant_id = current_tenant_id());

-- ── board_members ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS board_members_tenant_iso     ON "board_members";
DROP POLICY IF EXISTS board_members_tenant_select  ON "board_members";
DROP POLICY IF EXISTS board_members_tenant_insert  ON "board_members";
DROP POLICY IF EXISTS board_members_tenant_update  ON "board_members";
DROP POLICY IF EXISTS board_members_tenant_delete  ON "board_members";

CREATE POLICY board_members_tenant_select ON "board_members"
  FOR SELECT
  USING (tenant_id = current_tenant_id());
CREATE POLICY board_members_tenant_insert ON "board_members"
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY board_members_tenant_update ON "board_members"
  FOR UPDATE
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY board_members_tenant_delete ON "board_members"
  FOR DELETE
  USING (tenant_id = current_tenant_id());

-- ── labels ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS labels_tenant_iso     ON "labels";
DROP POLICY IF EXISTS labels_tenant_select  ON "labels";
DROP POLICY IF EXISTS labels_tenant_insert  ON "labels";
DROP POLICY IF EXISTS labels_tenant_update  ON "labels";
DROP POLICY IF EXISTS labels_tenant_delete  ON "labels";

CREATE POLICY labels_tenant_select ON "labels"
  FOR SELECT
  USING (tenant_id = current_tenant_id());
CREATE POLICY labels_tenant_insert ON "labels"
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY labels_tenant_update ON "labels"
  FOR UPDATE
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY labels_tenant_delete ON "labels"
  FOR DELETE
  USING (tenant_id = current_tenant_id());

-- ── checklists ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS checklists_tenant_iso     ON "checklists";
DROP POLICY IF EXISTS checklists_tenant_select  ON "checklists";
DROP POLICY IF EXISTS checklists_tenant_insert  ON "checklists";
DROP POLICY IF EXISTS checklists_tenant_update  ON "checklists";
DROP POLICY IF EXISTS checklists_tenant_delete  ON "checklists";

CREATE POLICY checklists_tenant_select ON "checklists"
  FOR SELECT
  USING (tenant_id = current_tenant_id());
CREATE POLICY checklists_tenant_insert ON "checklists"
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY checklists_tenant_update ON "checklists"
  FOR UPDATE
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY checklists_tenant_delete ON "checklists"
  FOR DELETE
  USING (tenant_id = current_tenant_id());

-- ── comments ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS comments_tenant_iso     ON "comments";
DROP POLICY IF EXISTS comments_tenant_select  ON "comments";
DROP POLICY IF EXISTS comments_tenant_insert  ON "comments";
DROP POLICY IF EXISTS comments_tenant_update  ON "comments";
DROP POLICY IF EXISTS comments_tenant_delete  ON "comments";

CREATE POLICY comments_tenant_select ON "comments"
  FOR SELECT
  USING (tenant_id = current_tenant_id());
CREATE POLICY comments_tenant_insert ON "comments"
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY comments_tenant_update ON "comments"
  FOR UPDATE
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY comments_tenant_delete ON "comments"
  FOR DELETE
  USING (tenant_id = current_tenant_id());


-- ============================================================================
-- 4. audit_logs — keep append-only contract
-- ============================================================================
-- audit_logs already had split SELECT + INSERT policies in 0002. Re-create
-- them defensively so the policy set is identical to the other tables in
-- shape. NO UPDATE / DELETE policy is added — under FORCE ROW LEVEL
-- SECURITY that means even the table owner cannot mutate audit rows
-- through this connection.

DROP POLICY IF EXISTS audit_logs_tenant_select ON "audit_logs";
DROP POLICY IF EXISTS audit_logs_tenant_insert ON "audit_logs";

CREATE POLICY audit_logs_tenant_select ON "audit_logs"
  FOR SELECT
  USING (tenant_id = current_tenant_id());
CREATE POLICY audit_logs_tenant_insert ON "audit_logs"
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());

-- (No UPDATE / DELETE policy — append-only.)


-- ============================================================================
-- 5. Refresh statistics
-- ============================================================================
-- After changing policies the planner should re-evaluate access paths.
-- Cheap on these small tables; safe to run unconditionally.

ANALYZE "boards";
ANALYZE "lists";
ANALYZE "cards";
ANALYZE "board_members";
ANALYZE "labels";
ANALYZE "checklists";
ANALYZE "comments";
ANALYZE "audit_logs";
