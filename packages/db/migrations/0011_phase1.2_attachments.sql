-- Migration: 0011_phase1.2_attachments.sql
-- Phase 1.2 (F1.2.8) — Attachments: file uploads + external links on cards.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS MIGRATION DOES
--
--   A. Creates the `attachments` table — a first-class entity (not JSONB).
--      Rationale: attachments need independent RLS, soft-delete, FK integrity,
--      and "my files" reverse-lookup. JSONB on cards would preclude all of this.
--
--   B. Adds `attachment_count integer NOT NULL DEFAULT 0` to `cards` so the
--      CardItem preview badge can read a denormalised count without a JOIN.
--      A trigger keeps this in sync automatically.
--
--   C. Installs split per-command RLS policies on `attachments`.
--      Pattern: tenant-only (no board_members EXISTS) because attachments
--      are reachable only through cards which already enforce membership.
--      Same rationale as card_assignees (0011) and checklist_items (0009).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- IDEMPOTENCY
--   CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
--   CREATE INDEX IF NOT EXISTS, DROP POLICY IF EXISTS, CREATE POLICY,
--   CREATE OR REPLACE FUNCTION / TRIGGER.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE
    '[migration 0011] Phase 1.2 F1.2.8 — creating attachments table, '
    'adding cards.attachment_count, trigger for auto-sync, split RLS.';
END$$;


-- ============================================================================
-- 1. attachments table
-- ============================================================================

CREATE TABLE IF NOT EXISTS "attachments" (
  "id"           uuid         PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"    uuid         NOT NULL,
  "card_id"      uuid         NOT NULL REFERENCES "cards"("id") ON DELETE CASCADE,
  "board_id"     uuid         NOT NULL,
  -- "file" | "link"
  "type"         varchar(10)  NOT NULL DEFAULT 'file',
  -- For file: CDN/presigned URL; for link: external URL
  "url"          text         NOT NULL,
  -- For file: objectKey in R2/MinIO; for link: NULL
  "object_key"   text,
  "mime_type"    varchar(128),
  "file_name"    varchar(255) NOT NULL,
  "size_bytes"   integer,
  -- For link attachments: optional display title
  "title"        varchar(255),
  -- varchar(128) matches users.id type (same as author_id on comments)
  "uploaded_by"  varchar(128) NOT NULL,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at"   timestamp with time zone
);


-- ============================================================================
-- 2. Indexes
-- ============================================================================

-- Card-scoped listing — dominant SELECT path.
CREATE INDEX IF NOT EXISTS "idx_attachments_card"
  ON "attachments" ("card_id", "tenant_id")
  WHERE "deleted_at" IS NULL;

-- Tenant planner-hint for RLS predicate.
CREATE INDEX IF NOT EXISTS "idx_attachments_tenant"
  ON "attachments" ("tenant_id")
  WHERE "deleted_at" IS NULL;


-- ============================================================================
-- 3. Row Level Security
-- ============================================================================

ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attachments" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attachments_tenant_select ON "attachments";
DROP POLICY IF EXISTS attachments_tenant_insert ON "attachments";
DROP POLICY IF EXISTS attachments_tenant_update ON "attachments";
DROP POLICY IF EXISTS attachments_tenant_delete ON "attachments";

CREATE POLICY attachments_tenant_select ON "attachments"
  FOR SELECT USING (tenant_id = current_tenant_id());

CREATE POLICY attachments_tenant_insert ON "attachments"
  FOR INSERT WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY attachments_tenant_update ON "attachments"
  FOR UPDATE
  USING      (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY attachments_tenant_delete ON "attachments"
  FOR DELETE USING (tenant_id = current_tenant_id());


-- ============================================================================
-- 4. Denormalised attachment_count on cards
-- ============================================================================

ALTER TABLE "cards"
  ADD COLUMN IF NOT EXISTS "attachment_count" integer NOT NULL DEFAULT 0;

-- ── Trigger function ──────────────────────────────────────────────────────────
-- Increments/decrements cards.attachment_count whenever an attachment row is
-- inserted or soft-deleted. GREATEST(..., 0) guards against negative counts.
-- SECURITY DEFINER allows the trigger to update cards even when the row-level
-- user would normally be denied an UPDATE on cards (the trigger runs as the
-- function owner, not the session user).

CREATE OR REPLACE FUNCTION update_card_attachment_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.deleted_at IS NULL THEN
    UPDATE "cards"
       SET attachment_count = attachment_count + 1
     WHERE id = NEW.card_id;

  ELSIF TG_OP = 'UPDATE'
    AND OLD.deleted_at IS NULL
    AND NEW.deleted_at IS NOT NULL
  THEN
    UPDATE "cards"
       SET attachment_count = GREATEST(attachment_count - 1, 0)
     WHERE id = NEW.card_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop before recreate so the trigger stays idempotent on re-run.
DROP TRIGGER IF EXISTS trg_attachment_count ON "attachments";

CREATE TRIGGER trg_attachment_count
  AFTER INSERT OR UPDATE OF deleted_at
  ON "attachments"
  FOR EACH ROW
  EXECUTE FUNCTION update_card_attachment_count();


-- ============================================================================
-- 5. Refresh planner statistics
-- ============================================================================

ANALYZE "attachments";
ANALYZE "cards";
