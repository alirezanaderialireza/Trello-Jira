// packages/db/src/schema/cards.ts

import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  date,
  uniqueIndex,
  index,
  integer,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaces } from "./workspaces";

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
    tenantId: uuid("tenant_id").references(() => workspaces.id, { onDelete: "cascade" }).notNull(),

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
    // 🔹 Due Date  (Phase 1.2 — F1.2.2)
    // =========================================================================
    // Wall-clock semantics, not an instant. See migration
    // 0008_phase1.2_due_date.sql header for the DATE-vs-TIMESTAMPTZ
    // doctrine. The on-the-wire representation in @repo/domain is
    // `DateOnly` (a branded `YYYY-MM-DD` string), kept in sync by
    // the type alias on `Card.dueDate` in
    // packages/domain/src/card/types.ts.
    dueDate: date("due_date"),

    // =========================================================================
    // 🔹 Card Cover  (Phase 1.2 — F1.2.7)
    // =========================================================================
    // Token: { type: "color"|"gradient"|"image", id: string } | null
    coverData: jsonb("cover_data"),

    // =========================================================================
    // 🔹 Attachment count  (Phase 1.2 — F1.2.8)
    // =========================================================================
    attachmentCount: integer("attachment_count").notNull().default(0),

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

    // Partial index for overdue / due-today sweeps. Only live, scheduled
    // cards land in this index — null and soft-deleted rows aren't
    // candidates. Tenant-scoped first column so the planner can satisfy
    // `tenant_id = $1 AND due_date < CURRENT_DATE` with an index-only scan.
    // Mirrors `idx_cards_due_date` in migration 0008.
    dueDateIdx: index("idx_cards_due_date")
      .on(table.tenantId, table.dueDate)
      .where(sql`${table.dueDate} IS NOT NULL AND ${table.deletedAt} IS NULL`),

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