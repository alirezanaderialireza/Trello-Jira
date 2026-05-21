// packages/db/src/schema/checklists.ts

import { pgTable, uuid, varchar, boolean, integer, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cards } from "./cards";

// ============================================================================
// Checklists Table — card-scoped task groups
// ============================================================================
export const checklists = pgTable(
  "checklists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    cardId: uuid("card_id").references(() => cards.id, { onDelete: "cascade" }).notNull(),
    boardId: uuid("board_id").notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    cardChecklistsIdx: index("idx_checklists_card")
      .on(table.cardId, table.position)
      .where(sql`${table.deletedAt} IS NULL`),
  })
);

// ============================================================================
// Checklist Items Table
// ============================================================================
export const checklistItems = pgTable(
  "checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    checklistId: uuid("checklist_id").references(() => checklists.id, { onDelete: "cascade" }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    completed: boolean("completed").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    checklistItemsIdx: index("idx_checklist_items_checklist")
      .on(table.checklistId, table.position),
  })
);

export type Checklist = typeof checklists.$inferSelect;
export type NewChecklist = typeof checklists.$inferInsert;
export type ChecklistItem = typeof checklistItems.$inferSelect;
export type NewChecklistItem = typeof checklistItems.$inferInsert;
