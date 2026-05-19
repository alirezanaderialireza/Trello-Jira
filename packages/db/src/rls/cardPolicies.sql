-- packages/db/src/rls/cardPolicies.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- PostgreSQL RLS — Card-Level Visibility Policies
--
-- Extends tenant isolation with card-level visibility rules.
-- Requires: card_acl table to exist (card_acl.sql migration must run first).
--
-- Policy logic mirrors CardAclEngine visibility check:
--   board_members  → any active board member can see the card
--   assignees_only → only assignees + ADMIN/OWNER board members
--   private        → only ADMIN/OWNER board members
-- ─────────────────────────────────────────────────────────────────────────────

-- card_acl table (created here if not exists)
CREATE TABLE IF NOT EXISTS card_acl (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id              uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  tenant_id            uuid NOT NULL,
  user_id              varchar(128),         -- NULL = applies to all board members
  granted_permissions  text[] NOT NULL DEFAULT '{}',
  denied_permissions   text[] NOT NULL DEFAULT '{}',
  is_locked            boolean NOT NULL DEFAULT false,
  visibility           varchar(32) NOT NULL DEFAULT 'board_members',
                       -- 'board_members' | 'assignees_only' | 'private'
  is_assignee          boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_card_acl_card_tenant ON card_acl(card_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_card_acl_user        ON card_acl(tenant_id, user_id);

ALTER TABLE card_acl ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_acl FORCE ROW LEVEL SECURITY;

CREATE POLICY card_acl_tenant_select ON card_acl FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY card_acl_tenant_insert ON card_acl FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY card_acl_tenant_update ON card_acl FOR UPDATE
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY card_acl_tenant_delete ON card_acl FOR DELETE USING (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON card_acl TO app_user;

-- ============================================================================
-- Card visibility policy (layered on top of tenant policy from tenantPolicies.sql)
-- ============================================================================

-- Drop the simple tenant-only SELECT policy (replaced by this richer one)
DROP POLICY IF EXISTS cards_tenant_select ON cards;

-- New layered visibility policy:
-- A card is visible to a user if:
--   (a) tenant matches AND
--   (b) no card_acl row with restricted visibility exists for this card, OR
--       the user is an assignee, OR
--       the user has at least ADMIN role in board_members
CREATE POLICY cards_visibility_select ON cards
  FOR SELECT
  USING (
    tenant_id = current_tenant_id()
    AND (
      -- No visibility restriction (no card_acl row, or visibility = 'board_members')
      NOT EXISTS (
        SELECT 1 FROM card_acl ca
        WHERE ca.card_id = cards.id
          AND ca.tenant_id = cards.tenant_id
          AND ca.visibility IN ('assignees_only', 'private')
      )
      OR
      -- User is an assignee
      EXISTS (
        SELECT 1 FROM card_acl ca
        WHERE ca.card_id = cards.id
          AND ca.tenant_id = cards.tenant_id
          AND ca.user_id = current_setting('app.current_user_id', true)
          AND ca.is_assignee = true
      )
      OR
      -- User is ADMIN or OWNER on the board
      EXISTS (
        SELECT 1 FROM board_members bm
        WHERE bm.board_id = cards.board_id
          AND bm.tenant_id = cards.tenant_id
          AND bm.user_id = current_setting('app.current_user_id', true)
          AND bm.role IN ('ADMIN', 'OWNER')
          AND bm.removed_at IS NULL
      )
    )
  );

-- ============================================================================
-- Role-aware board policies
-- ============================================================================

-- Drop old blanket UPDATE policy, replace with role-aware
DROP POLICY IF EXISTS boards_tenant_isolation_update ON boards;

CREATE POLICY boards_editor_update ON boards
  FOR UPDATE
  USING (
    tenant_id = current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM board_members bm
      WHERE bm.board_id = boards.id
        AND bm.tenant_id = boards.tenant_id
        AND bm.user_id = current_setting('app.current_user_id', true)
        AND bm.role IN ('EDITOR', 'ADMIN', 'OWNER')
        AND bm.removed_at IS NULL
    )
  )
  WITH CHECK (tenant_id = current_tenant_id());

-- Archive / delete restricted to ADMIN+
DROP POLICY IF EXISTS boards_tenant_isolation_delete ON boards;

CREATE POLICY boards_admin_delete ON boards
  FOR DELETE
  USING (
    tenant_id = current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM board_members bm
      WHERE bm.board_id = boards.id
        AND bm.tenant_id = boards.tenant_id
        AND bm.user_id = current_setting('app.current_user_id', true)
        AND bm.role IN ('ADMIN', 'OWNER')
        AND bm.removed_at IS NULL
    )
  );

-- Add current_user_id GUC setter function
CREATE OR REPLACE FUNCTION current_app_user_id() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT NULLIF(current_setting('app.current_user_id', true), '');
  $$;
