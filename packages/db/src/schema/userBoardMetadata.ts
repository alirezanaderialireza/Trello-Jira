// packages/db/src/schema/userBoardMetadata.ts

import {
  pgTable,
  uuid,
  boolean,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { boards } from "./boards";
import { workspaces } from "./workspaces";

// ─────────────────────────────────────────────────────────────────────────────
// user_board_metadata
//
// Per-(user, board) bookkeeping for sidebar surfaces:
//   • is_starred       — drives the "Starred" section.
//   • last_viewed_at   — drives the "Recent" section (top 5 by recency).
//
// `tenant_id` is denormalised onto this row (= boards.tenant_id) so the RLS
// policy can pre-filter on the same `current_tenant_id()` GUC the rest of
// the multi-tenant tables use, without a JOIN inside the policy.
//
// Mirrors the table created in migration
// 0006_phase11_shell_foundation.sql.
// ─────────────────────────────────────────────────────────────────────────────

export const userBoardMetadata = pgTable(
  "user_board_metadata",
  {
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    boardId: uuid("board_id")
      .references(() => boards.id, { onDelete: "cascade" })
      .notNull(),
    tenantId: uuid("tenant_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    isStarred: boolean("is_starred").notNull().default(false),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.boardId] }),
    starredIdx: index("idx_ubm_user_starred")
      .on(table.userId)
      .where(sql`${table.isStarred} = true`),
    recentIdx: index("idx_ubm_user_last_viewed")
      .on(table.userId, table.lastViewedAt)
      .where(sql`${table.lastViewedAt} IS NOT NULL`),
    tenantIdx: index("idx_ubm_tenant").on(table.tenantId),
  }),
);

export type UserBoardMetadata = typeof userBoardMetadata.$inferSelect;
export type NewUserBoardMetadata = typeof userBoardMetadata.$inferInsert;
