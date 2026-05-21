// packages/db/src/schema/lists.ts

import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { boards } from "./boards";
import { workspaces } from "./workspaces";

// ============================================================================
// 🃏 Lists Table Schema (Enterprise-Grade)
// ============================================================================
export const lists = pgTable(
  "lists",
  {
    // =========================================================================
    // 🔹 Identity
    // =========================================================================
    id: uuid("id").defaultRandom().primaryKey(),

    // =========================================================================
    // 🔹 Multi-Tenant Boundary
    // =========================================================================
    tenantId: uuid("tenant_id").references(() => workspaces.id, { onDelete: "cascade" }).notNull(),

    // =========================================================================
    // 🔹 Aggregate Reference
    // =========================================================================
    boardId: uuid("board_id")
      .references(() => boards.id, { onDelete: "cascade" })
      .notNull(),

    // =========================================================================
    // 🔹 Core Data
    // =========================================================================
    title: varchar("title", { length: 255 }).notNull(),

    // =========================================================================
    // 🔹 Fractional Index / LexoRank
    // =========================================================================
    position: varchar("position", { length: 255 }).notNull(),

    // =========================================================================
    // 🔹 Optimistic Concurrency Control (OCC)
    // =========================================================================
    revision: integer("revision").notNull().default(1),

    // =========================================================================
    // 🔹 Lifecycle
    // =========================================================================
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    // =========================================================================
    // 🔹 Primary Read Path (Board-level ordering)
    // =========================================================================
    boardOrderIdx: index("idx_lists_board_order")
      .on(table.tenantId, table.boardId, table.position.asc())
      .where(sql`${table.deletedAt} IS NULL`),

    // =========================================================================
    // 🔹 Position Integrity
    // =========================================================================
    uniquePosIdx: uniqueIndex("idx_unique_list_pos_per_board")
      .on(table.boardId, table.position)
      .where(sql`${table.deletedAt} IS NULL`),

    // =========================================================================
    // 🔹 Tenant Query Routing
    // =========================================================================
    tenantBoardIdx: index("idx_lists_tenant_board")
      .on(table.tenantId, table.boardId),

    // =========================================================================
    // 🔹 OCC Fast Filtering
    // =========================================================================
    revisionIdx: index("idx_lists_revision")
      .on(table.id, table.revision),

    // =========================================================================
    // 🔹 Soft Delete Queries
    // =========================================================================
    deletedIdx: index("idx_lists_deleted").on(table.deletedAt),
  })
);

// =============================================================================
// 🏷️ TypeScript Types
// =============================================================================
export type List = typeof lists.$inferSelect;
export type NewList = typeof lists.$inferInsert;