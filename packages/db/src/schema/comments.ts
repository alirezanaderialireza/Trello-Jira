// packages/db/src/schema/comments.ts
//
// Phase 1.2 (F1.2.4.a) — hardened from the Phase-4 rich-card stub.
//
// Changes vs the original stub:
//   • revision   integer NOT NULL DEFAULT 0     — OCC + event version
//   • updatedAt  timestamptz NOT NULL DEFAULT now() — audit trail
//   • deletedBy  uuid (nullable FK → users.id)  — soft-delete attribution
//   • Added tenant planner-hint index (mirrors 0010 migration)
//
// NOTE: authorId remains varchar(128) (not uuid FK) — see migration 0010
// header for the rationale. A future migration can cast it safely.

import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cards } from "./cards";
import { users } from "./users";

// ============================================================================
// Comments Table — card-scoped discussion threads
// ============================================================================
export const comments = pgTable(
  "comments",
  {
    id:        uuid("id").primaryKey().defaultRandom(),
    tenantId:  uuid("tenant_id").notNull(),
    cardId:    uuid("card_id")
                 .references(() => cards.id, { onDelete: "cascade" })
                 .notNull(),
    boardId:   uuid("board_id").notNull(),
    // varchar(128) — kept for backward compat; contains valid UUID strings
    authorId:  varchar("author_id", { length: 128 }).notNull(),
    body:      text("body").notNull(),
    // OCC + event version tracking (F1.2.4.a D2)
    revision:  integer("revision").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
                 .notNull()
                 .defaultNow(),
    editedAt:  timestamp("edited_at",  { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
                 .notNull()
                 .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    // soft-delete attribution — who deleted this comment (D5)
    deletedBy: uuid("deleted_by").references(() => users.id),
  },
  (table) => ({
    // Card-scoped ordered listing — dominant SELECT path (pagination)
    cardCommentsIdx: index("idx_comments_card")
      .on(table.cardId, table.createdAt)
      .where(sql`${table.deletedAt} IS NULL`),
    // Board-scoped index (future board-level activity queries)
    boardCommentsIdx: index("idx_comments_board")
      .on(table.tenantId, table.boardId)
      .where(sql`${table.deletedAt} IS NULL`),
    // Tenant planner-hint for RLS predicate (added in migration 0010)
    tenantIdx: index("idx_comments_tenant")
      .on(table.tenantId),
  }),
);

export type Comment    = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
