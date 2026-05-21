// packages/db/src/schema/sessions.ts
// -----------------------------------------------------------------------------
// Sessions & Token Revocation schemas.
// Production-grade: RS256 access tokens (15 min), opaque refresh tokens (7 days),
// per-session lastAccessJti for atomic rotation, pub/sub invalidation support.
// -----------------------------------------------------------------------------

import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ============================================================================
// 🔐 Sessions Table
// ============================================================================
// One row per authenticated session (device/browser).
// Refresh token is stored as an opaque hash (SHA-256).
// lastAccessJti is updated on every successful access-token issuance —
// used to detect replay attacks during rotation.
// ============================================================================

export const sessions = pgTable(
  "sessions",
  {
    // -------------------------------------------------------------------------
    // Identity
    // -------------------------------------------------------------------------
    id: uuid("id").primaryKey().defaultRandom(),

    // -------------------------------------------------------------------------
    // Actor & Tenant
    // -------------------------------------------------------------------------
    userId: varchar("user_id", { length: 128 }).notNull(),
    tenantId: uuid("tenant_id").notNull(),

    // -------------------------------------------------------------------------
    // Refresh token (opaque, stored as SHA-256 hash — never plaintext)
    // -------------------------------------------------------------------------
    refreshTokenHash: varchar("refresh_token_hash", { length: 64 }).notNull(),

    // -------------------------------------------------------------------------
    // Rotation guard — last JTI issued to this session.
    // On rotation: compare incoming refresh-token with this JTI to detect
    // concurrent rotation (race-condition guard).
    // -------------------------------------------------------------------------
    lastAccessJti: varchar("last_access_jti", { length: 36 }),

    // -------------------------------------------------------------------------
    // Device / Client fingerprint (for audit + anomaly detection)
    // -------------------------------------------------------------------------
    userAgent: varchar("user_agent", { length: 512 }),
    ipAddress: varchar("ip_address", { length: 45 }), // IPv6-safe

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------
    isRevoked: boolean("is_revoked").notNull().default(false),
    revokedReason: varchar("revoked_reason", { length: 128 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Fast lookup by userId (list all sessions for a user)
    userIdx: index("idx_sessions_user").on(table.userId),

    // Tenant isolation
    tenantIdx: index("idx_sessions_tenant").on(table.tenantId),

    // Active session lookup (most common read path)
    activeUserIdx: index("idx_sessions_active_user")
      .on(table.userId, table.tenantId)
      .where(sql`${table.isRevoked} = false AND ${table.expiresAt} > now()`),

    // Rotation guard: unique refresh token hash (enforce one-time use)
    refreshHashIdx: uniqueIndex("idx_sessions_refresh_hash")
      .on(table.refreshTokenHash),
  })
);

// ============================================================================
// 🚫 Revoked Tokens Table
// ============================================================================
// Short-lived blocklist for access tokens that have been invalidated before
// their natural RS256 TTL expires (logout, role-change, password reset).
// Redis holds the hot cache; this table is the durable fallback.
// GC job deletes rows where expiresAt < now() — run every 15 minutes.
// ============================================================================

export const revokedTokens = pgTable(
  "revoked_tokens",
  {
    // JTI (JWT ID) of the revoked access token
    jti: varchar("jti", { length: 36 }).primaryKey(),

    // Who revoked it (for audit)
    userId: varchar("user_id", { length: 128 }).notNull(),
    tenantId: uuid("tenant_id").notNull(),

    // Why revoked
    reason: varchar("reason", { length: 128 }).notNull().default("LOGOUT"),

    // When it naturally expires — used by GC to prune stale rows
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // GC index — only scan non-expired rows
    gcIdx: index("idx_revoked_tokens_expires")
      .on(table.expiresAt)
      .where(sql`${table.expiresAt} > now()`),

    // Per-user revocation list
    userIdx: index("idx_revoked_tokens_user").on(table.userId),
  })
);

// =============================================================================
// Types
// =============================================================================
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type RevokedToken = typeof revokedTokens.$inferSelect;
export type NewRevokedToken = typeof revokedTokens.$inferInsert;
