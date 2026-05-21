-- Migration: 0001_phase2_auth_acl.sql
-- Phase 2: Sessions, Revoked Tokens, full schema alignment
-- Run after 0000_great_johnny_blaze.sql

-- ============================================================================
-- Fix initial migration gap: create all missing tables from schema
-- ============================================================================

-- boards
CREATE TABLE IF NOT EXISTS "boards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "title" text NOT NULL,
  "revision" integer NOT NULL DEFAULT 1,
  "acl_version" integer NOT NULL DEFAULT 1,
  "current_sequence" integer NOT NULL DEFAULT 0,
  "archived_at" timestamp with time zone,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_boards_tenant" ON "boards" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_boards_active_tenant" ON "boards" ("tenant_id") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_boards_revision" ON "boards" ("id", "revision");
CREATE INDEX IF NOT EXISTS "idx_boards_acl_version" ON "boards" ("id", "acl_version");
CREATE INDEX IF NOT EXISTS "idx_boards_sequence" ON "boards" ("id", "current_sequence");

-- board_members
CREATE TABLE IF NOT EXISTS "board_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "board_id" uuid REFERENCES "boards"("id") ON DELETE CASCADE NOT NULL,
  "user_id" varchar(128) NOT NULL,
  "role" varchar(32) NOT NULL DEFAULT 'MEMBER',
  "revision" integer NOT NULL DEFAULT 1,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "removed_at" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_unique_active_board_member"
  ON "board_members" ("board_id", "user_id")
  WHERE "removed_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_board_members_board"
  ON "board_members" ("tenant_id", "board_id")
  WHERE "removed_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_board_members_user"
  ON "board_members" ("tenant_id", "user_id")
  WHERE "removed_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_board_members_acl"
  ON "board_members" ("tenant_id", "board_id", "user_id", "role")
  WHERE "removed_at" IS NULL;

-- lists
CREATE TABLE IF NOT EXISTS "lists" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "board_id" uuid REFERENCES "boards"("id") ON DELETE CASCADE NOT NULL,
  "title" varchar(255) NOT NULL,
  "position" varchar(255) NOT NULL,
  "revision" integer NOT NULL DEFAULT 1,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);

-- Drop the initial cards table (wrong schema from 0000)
DROP TABLE IF EXISTS "cards";

-- cards (correct schema)
CREATE TABLE IF NOT EXISTS "cards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "board_id" uuid REFERENCES "boards"("id") ON DELETE CASCADE NOT NULL,
  "list_id" uuid REFERENCES "lists"("id") ON DELETE CASCADE NOT NULL,
  "title" varchar(255) NOT NULL,
  "description" text,
  "position" varchar(255) NOT NULL,
  "revision" integer NOT NULL DEFAULT 1,
  "accounting_data" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "idx_cards_list_order"
  ON "cards" ("tenant_id", "list_id", "position" ASC)
  WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_cards_board_sync"
  ON "cards" ("tenant_id", "board_id")
  WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_cards_revision" ON "cards" ("id", "revision");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_unique_card_pos_per_list"
  ON "cards" ("list_id", "position")
  WHERE "deleted_at" IS NULL;

-- outbox_events
CREATE TABLE IF NOT EXISTS "outbox_events" (
  "event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_version" varchar(32) NOT NULL,
  "aggregate_id" uuid NOT NULL,
  "aggregate_type" varchar(64) NOT NULL,
  "type" varchar(128) NOT NULL,
  "sequence" integer NOT NULL,
  "occurred_at" timestamp NOT NULL DEFAULT now(),
  "causation_id" varchar(128),
  "correlation_id" varchar(128),
  "payload" jsonb NOT NULL,
  "processed_at" timestamp
);

CREATE INDEX IF NOT EXISTS "outbox_unprocessed_idx"
  ON "outbox_events" ("processed_at")
  WHERE "processed_at" IS NULL;
CREATE INDEX IF NOT EXISTS "outbox_agg_seq_idx"
  ON "outbox_events" ("aggregate_id", "sequence");

-- audit_logs
CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL,
  "action" varchar(128) NOT NULL,
  "entity_id" uuid NOT NULL,
  "entity_type" varchar(64) NOT NULL,
  "correlation_id" varchar(128) NOT NULL,
  "before_state" jsonb NOT NULL,
  "after_state" jsonb NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "audit_entity_idx" ON "audit_logs" ("entity_id", "entity_type");
CREATE INDEX IF NOT EXISTS "audit_tenant_idx" ON "audit_logs" ("tenant_id");
-- Covering index for SIEM timeline queries
CREATE INDEX IF NOT EXISTS "audit_tenant_time_idx" ON "audit_logs" ("tenant_id", "created_at" DESC);

-- idempotency_keys
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "mutation_id" varchar(128) PRIMARY KEY NOT NULL,
  "response" jsonb NOT NULL,
  "schema_version" varchar(32) NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idempotency_created_idx" ON "idempotency_keys" ("created_at");

-- board_sequences
CREATE TABLE IF NOT EXISTS "board_sequences" (
  "board_id" uuid PRIMARY KEY NOT NULL,
  "next_value" integer NOT NULL DEFAULT 1
);

-- ============================================================================
-- NEW: Sessions table (Phase 2)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar(128) NOT NULL,
  "tenant_id" uuid NOT NULL,
  "refresh_token_hash" varchar(64) NOT NULL,
  "last_access_jti" varchar(36),
  "user_agent" varchar(512),
  "ip_address" varchar(45),
  "is_revoked" boolean NOT NULL DEFAULT false,
  "revoked_reason" varchar(128),
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_used_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_sessions_user" ON "sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_sessions_tenant" ON "sessions" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_sessions_active_user"
  ON "sessions" ("user_id", "tenant_id")
  WHERE "is_revoked" = false AND "expires_at" > now();
CREATE UNIQUE INDEX IF NOT EXISTS "idx_sessions_refresh_hash"
  ON "sessions" ("refresh_token_hash");

-- ============================================================================
-- NEW: Revoked Tokens table (Phase 2)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "revoked_tokens" (
  "jti" varchar(36) PRIMARY KEY NOT NULL,
  "user_id" varchar(128) NOT NULL,
  "tenant_id" uuid NOT NULL,
  "reason" varchar(128) NOT NULL DEFAULT 'LOGOUT',
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_revoked_tokens_expires"
  ON "revoked_tokens" ("expires_at")
  WHERE "expires_at" > now();
CREATE INDEX IF NOT EXISTS "idx_revoked_tokens_user"
  ON "revoked_tokens" ("user_id");
