// packages/db/src/schema/idempotency.ts
//
// Fixes applied:
// ✅ BUG-013: Added expiresAt column + expiredIdx for TTL-based cleanup.
//             Idempotency records have a finite usefulness window (e.g. 24h).
//             Without expiry, the table grows unboundedly in production.
//             A background job (or worker) can DELETE WHERE expires_at < now().
// ✅ BUG-014: Added tenantId to prevent cross-tenant idempotency collisions.
//             mutationId is client-supplied and not globally unique. Two tenants
//             could independently generate the same short mutationId (e.g. "1").
//             Composite PK (mutationId, tenantId) ensures per-tenant uniqueness.

import { pgTable, uuid, varchar, jsonb, timestamp, index, primaryKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    // =========================================================================
    // ✅ BUG-014: tenantId added — composite PK = (mutationId, tenantId)
    // =========================================================================
    mutationId: varchar("mutation_id", { length: 128 }).notNull(),
    tenantId:   uuid("tenant_id").notNull(),

    // =========================================================================
    // Stored Response
    // =========================================================================
    response: jsonb("response").notNull(),

    // =========================================================================
    // Schema Versioning
    // =========================================================================
    schemaVersion: varchar("schema_version", { length: 32 }).notNull(),

    // =========================================================================
    // Lifecycle
    // =========================================================================
    createdAt: timestamp("created_at").notNull().defaultNow(),
    // ✅ BUG-013: expiresAt — enables TTL cleanup
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => ({
    // ✅ BUG-014: composite primary key
    pk: primaryKey({ columns: [table.mutationId, table.tenantId] }),

    // for queries by tenant
    tenantIdx: index("idempotency_tenant_idx").on(table.tenantId),

    // ✅ BUG-013: for TTL cleanup job
    expiredIdx: index("idempotency_expired_idx")
      .on(table.expiresAt)
      .where(sql`${table.expiresAt} < now()`),
  }),
);

// =============================================================================
// Types
// =============================================================================
export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;
