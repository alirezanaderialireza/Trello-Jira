// packages/db/src/schema/comments.ts

import { pgTable, uuid, varchar, text, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cards } from "./cards";

// ============================================================================
// Comments Table — card-scoped discussion threads
// ============================================================================
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    cardId: uuid("card_id").references(() => cards.id, { onDelete: "cascade" }).notNull(),
    boardId: uuid("board_id").notNull(),
    authorId: varchar("author_id", { length: 128 }).notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    cardCommentsIdx: index("idx_comments_card")
      .on(table.cardId, table.createdAt)
      .where(sql`${table.deletedAt} IS NULL`),
    boardCommentsIdx: index("idx_comments_board")
      .on(table.tenantId, table.boardId)
      .where(sql`${table.deletedAt} IS NULL`),
  })
);

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
