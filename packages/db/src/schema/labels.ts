// packages/db/src/schema/labels.ts

import { pgTable, uuid, varchar, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { boards } from "./boards";

// ============================================================================
// Labels Table — board-scoped color tags
// ============================================================================
export const labels = pgTable(
  "labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    boardId: uuid("board_id").references(() => boards.id, { onDelete: "cascade" }).notNull(),
    name: varchar("name", { length: 64 }).notNull(),
    color: varchar("color", { length: 7 }).notNull(), // hex: #FF0000
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    boardLabelsIdx: index("idx_labels_board")
      .on(table.tenantId, table.boardId)
      .where(sql`${table.deletedAt} IS NULL`),
    uniqueNamePerBoard: uniqueIndex("idx_labels_unique_name")
      .on(table.boardId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
  })
);

// ============================================================================
// Card-Label junction table (many-to-many)
// ============================================================================
export const cardLabels = pgTable(
  "card_labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cardId: uuid("card_id").notNull(),
    labelId: uuid("label_id").references(() => labels.id, { onDelete: "cascade" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueCardLabel: uniqueIndex("idx_card_labels_unique")
      .on(table.cardId, table.labelId),
    cardIdx: index("idx_card_labels_card").on(table.cardId),
    labelIdx: index("idx_card_labels_label").on(table.labelId),
  })
);

export type Label = typeof labels.$inferSelect;
export type NewLabel = typeof labels.$inferInsert;
export type CardLabel = typeof cardLabels.$inferSelect;
