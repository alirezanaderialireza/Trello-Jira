-- Migration: 0012_phase1.2_card_cover.sql
-- Phase 1.2 (F1.2.7) — Card Cover (color / gradient).
--
-- WHAT THIS MIGRATION DOES:
--   Adds cover_data JSONB column to cards table.
--   Shape: { type: "color" | "gradient", id: string } | NULL
--   Same BackgroundData token as board backgrounds.
--   Image covers reserved for F1.2.8.
--
-- IDEMPOTENCY: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.
-- RLS: no new policy — cover_data inherits existing cards RLS.

DO $$
BEGIN
  RAISE NOTICE '[migration 0012] Phase 1.2 F1.2.7 — adding cover_data JSONB column to cards.';
END$$;

ALTER TABLE "cards"
  ADD COLUMN IF NOT EXISTS "cover_data" jsonb;

CREATE INDEX IF NOT EXISTS "idx_cards_cover"
  ON "cards" ("tenant_id")
  WHERE "cover_data" IS NOT NULL
    AND "deleted_at" IS NULL;

ANALYZE "cards";
