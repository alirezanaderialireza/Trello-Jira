// packages/db/src/schema/cards.ts

import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
  integer,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { boards } from "./boards";
import { lists } from "./lists";

// ============================================================================
// 🃏 Cards Table Schema (Enterprise-Grade)
// ============================================================================
export const cards = pgTable(
  "cards",
  {
    // =========================================================================
    // 🔹 Identity
    // =========================================================================
    id: uuid("id").defaultRandom().primaryKey(),

    // =========================================================================
    // 🔹 Multi-Tenant Boundary
    // =========================================================================
    tenantId: uuid("tenant_id").notNull(),

    // =========================================================================
    // 🔹 Aggregate References
    // =========================================================================
    boardId: uuid("board_id")
      .references(() => boards.id, { onDelete: "cascade" })
      .notNull(),
    listId: uuid("list_id")
      .references(() => lists.id, { onDelete: "cascade" })
      .notNull(),

    // =========================================================================
    // 🔹 Core Card Data
    // =========================================================================
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),

    // =========================================================================
    // 🔹 Fractional Ordering / LexoRank
    // =========================================================================
    position: varchar("position", { length: 255 }).notNull(),

    // =========================================================================
    // 🔹 Optimistic Concurrency Control (OCC)
    // =========================================================================
    revision: integer("revision").notNull().default(1),

    // =========================================================================
    // 🔹 Extensible Metadata
    // =========================================================================
    accountingData: jsonb("accounting_data"),

    // =========================================================================
    // 🔹 Lifecycle
    // =========================================================================
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    // =========================================================================
    // 🔹 Indexes for Performance & Constraints
    // =========================================================================
    listOrderIdx: index("idx_cards_list_order")
      .on(table.tenantId, table.listId, table.position.asc())
      .where(sql`${table.deletedAt} IS NULL`),

    boardSyncIdx: index("idx_cards_board_sync")
      .on(table.tenantId, table.boardId)
      .where(sql`${table.deletedAt} IS NULL`),

    revisionIdx: index("idx_cards_revision").on(table.id, table.revision),

    deletedAtIdx: index("idx_cards_deleted_at").on(table.deletedAt),

    uniquePosIdx: uniqueIndex("idx_unique_card_pos_per_list")
      .on(table.listId, table.position)
      .where(sql`${table.deletedAt} IS NULL`),
  })
);

// =============================================================================
// 🏷️ TypeScript Types
// =============================================================================
export type Card = typeof cards.$inferSelect;
export type NewCard = typeof cards.$inferInsert;