// packages/db/src/schema/sessions.ts
//
// ============================================================================
// 🗄️ Sessions + Token Revocation Schema
// ============================================================================
//
// sessions     — one row per active login session.  Holds the current refresh
//               token hash, expiry, device metadata, and a pointer to the
//               latest access token JTI (used for revocation on logout).
//
// revokedTokens — append-only revocation list for access tokens that were
//               invalidated before expiry (logout, password change, role
//               change).  Rows are purged by a background job once exp passes.
//               Redis is the hot path; this table is the durable fallback.
//
// ============================================================================

import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ============================================================================
// Sessions
// ============================================================================

export const sessions = pgTable(
  "sessions",
  {
    // ── Identity ──────────────────────────────────────────────────────────
    id:       uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    userId:   varchar("user_id", { length: 128 }).notNull(),

    // ── Refresh Token (stored as plain token; hash in production via pgcrypto) ─
    refreshToken:          varchar("refresh_token", { length: 256 }).notNull().unique(),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }).notNull(),

    // ── Latest Access Token JTI (to revoke on logout / rotation) ─────────
    lastAccessJti: varchar("last_access_jti", { length: 128 }),

    // ── Session Claims Snapshot (denormalized for fast propagation) ───────
    roles: jsonb("roles").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    aclV:  varchar("acl_v", { length: 16 }).notNull().default("1"),

    // ── Device / Client Metadata ──────────────────────────────────────────
    deviceId:   varchar("device_id",   { length: 256 }),
    userAgent:  text("user_agent"),
    ipAddress:  varchar("ip_address",  { length: 45 }),  // IPv6 max len
    origin:     varchar("origin",      { length: 256 }),

    // ── Lifecycle ─────────────────────────────────────────────────────────
    isActive:    boolean("is_active").notNull().default(true),
    revokedAt:   timestamp("revoked_at",  { withTimezone: true }),
    lastSeenAt:  timestamp("last_seen_at",{ withTimezone: true }).notNull().defaultNow(),
    createdAt:   timestamp("created_at",  { withTimezone: true }).notNull().defaultNow(),
    updatedAt:   timestamp("updated_at",  { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx:          index("idx_sessions_user")
                        .on(t.tenantId, t.userId)
                        .where(sql`${t.isActive} = true`),
    refreshTokenIdx:  uniqueIndex("idx_sessions_refresh_token")
                        .on(t.refreshToken),
    expiryGcIdx:      index("idx_sessions_expiry_gc")
                        .on(t.refreshTokenExpiresAt),
  }),
);

export type Session    = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

// ============================================================================
// Revoked Tokens (durable fallback for Redis)
// ============================================================================

export const revokedTokens = pgTable(
  "revoked_tokens",
  {
    id:        uuid("id").primaryKey().defaultRandom(),
    jti:       varchar("jti", { length: 128 }).notNull().unique(),
    /** epoch seconds — matches JWT exp.  Row is safe to delete after this. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull().defaultNow(),
    reason:    varchar("reason", { length: 64 }),
  },
  (t) => ({
    jtiIdx:    uniqueIndex("idx_revoked_tokens_jti").on(t.jti),
    gcIdx:     index("idx_revoked_tokens_gc").on(t.expiresAt),
  }),
);

export type RevokedToken    = typeof revokedTokens.$inferSelect;
export type NewRevokedToken = typeof revokedTokens.$inferInsert;
