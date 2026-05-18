// packages/db/src/schema/boards.ts

import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const boards = pgTable(
  "boards",
  {
    // =========================================================================
    // 🔹 Identity
    // =========================================================================
    id: uuid("id")
      .primaryKey()
      .defaultRandom(),

    // =========================================================================
    // 🔹 Multi-Tenant Isolation
    // =========================================================================
    tenantId: uuid("tenant_id").notNull(),

    // =========================================================================
    // 🔹 Core Board Data
    // =========================================================================
    title: text("title").notNull(),

    // =========================================================================
    // 🔹 Optimistic Concurrency Control
    // =========================================================================
    revision: integer("revision")
      .notNull()
      .default(1),

    // =========================================================================
    // 🔹 ACL Versioning
    // =========================================================================
    aclVersion: integer("acl_version")
      .notNull()
      .default(1),

    // =========================================================================
    // 🔹 Realtime / Sync Sequence
    // =========================================================================
    currentSequence: integer("current_sequence")
      .notNull()
      .default(0),

    // =========================================================================
    // 🔹 Lifecycle
    // =========================================================================
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // =========================================================================
    // 🔹 Tenant Isolation
    // =========================================================================
    tenantIdx: index("idx_boards_tenant").on(table.tenantId),

    // =========================================================================
    // 🔹 Active Boards Query Path
    // =========================================================================
    activeTenantBoardsIdx: index("idx_boards_active_tenant")
      .on(table.tenantId)
      .where(sql`${table.deletedAt} IS NULL`),

    // =========================================================================
    // 🔹 OCC Fast Path
    // =========================================================================
    revisionIdx: index("idx_boards_revision").on(table.id, table.revision),

    // =========================================================================
    // 🔹 ACL Cache Invalidation
    // =========================================================================
    aclVersionIdx: index("idx_boards_acl_version").on(table.id, table.aclVersion),

    // =========================================================================
    // 🔹 Archive Query Optimization
    // =========================================================================
    archivedIdx: index("idx_boards_archived").on(table.archivedAt),

    // =========================================================================
    // 🔹 Realtime Sync Ordering
    // =========================================================================
    sequenceIdx: index("idx_boards_sequence").on(table.id, table.currentSequence),
  })
);

// =============================================================================
// Types
// =============================================================================

export type Board = typeof boards.$inferSelect;
export type NewBoard = typeof boards.$inferInsert;