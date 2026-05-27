// packages/db/src/schema/boards.ts

import {
  pgTable,
  uuid,
  text,
  varchar,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaces } from "./workspaces";

// ─────────────────────────────────────────────────────────────────────────────
// `visibility` mirrors the CHECK constraint added in migration
// 0006_phase11_shell_foundation.sql.  Keep the literal union and the SQL
// CHECK in sync.
//   workspace = visible to every workspace member
//   private   = only board members
//   public    = anyone with the link (future use)
// ─────────────────────────────────────────────────────────────────────────────
export type BoardVisibility = "workspace" | "private" | "public";

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
    tenantId: uuid("tenant_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),

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
    // 🔹 Phase 1.1 (mig 0006) — UX columns
    // =========================================================================
    description: text("description"),
    visibility: varchar("visibility", { length: 10 })
      .$type<BoardVisibility>()
      .notNull()
      .default("workspace"),
    backgroundData: jsonb("background_data"),

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