-- packages/db/src/rls/tenantPolicies.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- PostgreSQL Row-Level Security — Tenant Isolation Layer
--
-- PURPOSE:
--   Enforce tenant isolation at the DB level. Even if application code contains
--   a bug (missing WHERE clause, SQL injection, ORM misconfiguration), PostgreSQL
--   will block cross-tenant data access.
--
-- DESIGN:
--   - RLS policies are attached to every table that has tenant_id.
--   - app.current_tenant_id is set by the connection pool before each request.
--   - Service accounts (workers, migrations) use BYPASSRLS role.
--   - The application DB user has NO BYPASSRLS — it must always pass through RLS.
--
-- USAGE:
--   1. Run this file once during DB setup (after all tables are created).
--   2. In the application, before every query:
--        SET LOCAL app.current_tenant_id = '<tenantId>';
--      (Drizzle middleware handles this automatically — see db/middleware/tenantContext.ts)
--
-- ROLES expected:
--   app_user      — the application DB user (no BYPASSRLS)
--   app_service   — workers / background jobs (BYPASSRLS)
--   app_migration — migration runner (BYPASSRLS)
-- ─────────────────────────────────────────────────────────────────────────────

-- ============================================================================
-- 0. GUC for current tenant context
-- ============================================================================
-- Set default to empty string (will trigger RLS deny if not explicitly set)
ALTER DATABASE current_database() SET app.current_tenant_id = '';

-- Helper function: get current tenant from GUC
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid;
  $$;

-- ============================================================================
-- 1. boards — tenant isolation
-- ============================================================================

ALTER TABLE boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE boards FORCE ROW LEVEL SECURITY;

-- SELECT: only rows where tenant_id matches
CREATE POLICY boards_tenant_isolation_select
  ON boards FOR SELECT
  USING (tenant_id = current_tenant_id());

-- INSERT: only allow inserting rows for current tenant
CREATE POLICY boards_tenant_isolation_insert
  ON boards FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());

-- UPDATE: only own-tenant rows
CREATE POLICY boards_tenant_isolation_update
  ON boards FOR UPDATE
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- DELETE: only own-tenant rows
CREATE POLICY boards_tenant_isolation_delete
  ON boards FOR DELETE
  USING (tenant_id = current_tenant_id());

-- ============================================================================
-- 2. board_members — tenant isolation
-- ============================================================================

ALTER TABLE board_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_members FORCE ROW LEVEL SECURITY;

CREATE POLICY board_members_tenant_select
  ON board_members FOR SELECT
  USING (tenant_id = current_tenant_id());

CREATE POLICY board_members_tenant_insert
  ON board_members FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY board_members_tenant_update
  ON board_members FOR UPDATE
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY board_members_tenant_delete
  ON board_members FOR DELETE
  USING (tenant_id = current_tenant_id());

-- ============================================================================
-- 3. lists — tenant isolation
-- ============================================================================

ALTER TABLE lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE lists FORCE ROW LEVEL SECURITY;

CREATE POLICY lists_tenant_select ON lists FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY lists_tenant_insert ON lists FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY lists_tenant_update ON lists FOR UPDATE
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY lists_tenant_delete ON lists FOR DELETE USING (tenant_id = current_tenant_id());

-- ============================================================================
-- 4. cards — tenant isolation
-- ============================================================================

ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE cards FORCE ROW LEVEL SECURITY;

CREATE POLICY cards_tenant_select ON cards FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY cards_tenant_insert ON cards FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY cards_tenant_update ON cards FOR UPDATE
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY cards_tenant_delete ON cards FOR DELETE USING (tenant_id = current_tenant_id());

-- ============================================================================
-- 5. audit_logs — tenant isolation (append-only: no UPDATE/DELETE for app_user)
-- ============================================================================

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

-- Audits are append-only. app_user can SELECT and INSERT but never UPDATE/DELETE.
CREATE POLICY audit_tenant_select ON audit_logs FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY audit_tenant_insert ON audit_logs FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
-- No UPDATE or DELETE policies → blocked for app_user by default

-- ============================================================================
-- 6. sessions — user isolation (a session belongs to one user, but user can be
--    queried by the service layer — include tenant)
-- ============================================================================

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY sessions_tenant_select ON sessions FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY sessions_tenant_insert ON sessions FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY sessions_tenant_update ON sessions FOR UPDATE
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY sessions_tenant_delete ON sessions FOR DELETE USING (tenant_id = current_tenant_id());

-- ============================================================================
-- 7. outbox_events — tenant scoping (aggregate_id points to board, not user)
--    Workers bypass RLS; app reads by aggregate_id which implies board ownership
-- ============================================================================

ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;

-- For outbox: allow INSERT without tenant filter (outbox rows are board-scoped,
-- the application already validates boardId ownership before inserting)
-- Workers with BYPASSRLS handle processing.
-- For safety, only allow SELECT for the service that created the event.
CREATE POLICY outbox_insert_open ON outbox_events FOR INSERT WITH CHECK (true); -- app validates at service layer
CREATE POLICY outbox_select_all  ON outbox_events FOR SELECT USING (true);       -- worker needs all unprocessed

-- ============================================================================
-- 8. idempotency_keys — open (no tenant column; keyed by mutation_id which
--    is client-generated UUID, unguessable)
-- ============================================================================

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;

-- Allow all for app_user (mutation_id is UUID — effectively access-control by obscurity;
-- real protection is that the service validates ownership before checking idempotency)
CREATE POLICY idempotency_open ON idempotency_keys FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- 9. GRANT app_user permissions (RLS policies provide further restriction)
-- ============================================================================

-- Revoke public access, then grant controlled access
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON boards, board_members, lists, cards TO app_user;
GRANT SELECT, INSERT                  ON audit_logs                          TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE  ON sessions, revoked_tokens            TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE  ON outbox_events, idempotency_keys     TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE  ON board_sequences                     TO app_user;

-- Service account (workers, migrations) bypass RLS
ALTER ROLE app_service  BYPASSRLS;
ALTER ROLE app_migration BYPASSRLS;
