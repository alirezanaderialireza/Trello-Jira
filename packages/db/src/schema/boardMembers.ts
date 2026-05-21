// packages/db/src/schema/boardMembers.ts

import {
  pgTable,
  uuid,
  varchar,
  timestamp,
import { workspaces } from "./workspaces";
  uniqueIndex,
  index,
  integer,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { boards } from "./boards";

// ============================================================================
// 🏷️ Board Members Table Schema
// ============================================================================
export const boardMembers = pgTable(
  "board_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => workspaces.id, { onDelete: "cascade" }).notNull(),
    boardId: uuid("board_id").references(() => boards.id, { onDelete: "cascade" }).notNull(),
    userId: varchar("user_id", { length: 128 }).notNull(),
    role: varchar("role", { length: 32 }).notNull().default("MEMBER"),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    removedAt: timestamp("removed_at"),
  },
  (table) => ({
    uniqueActiveMemberIdx: uniqueIndex("idx_unique_active_board_member")
      .on(table.boardId, table.userId)
      .where(sql`${table.removedAt} IS NULL`),
    boardMembersIdx: index("idx_board_members_board")
      .on(table.tenantId, table.boardId)
      .where(sql`${table.removedAt} IS NULL`),
    userBoardsIdx: index("idx_board_members_user")
      .on(table.tenantId, table.userId)
      .where(sql`${table.removedAt} IS NULL`),
    roleLookupIdx: index("idx_board_members_acl")
      .on(table.tenantId, table.boardId, table.userId, table.role)
      .where(sql`${table.removedAt} IS NULL`),
  })
);

// =============================================================================
// 🏷️ Types
// =============================================================================
export type BoardMember = typeof boardMembers.$inferSelect;
export type NewBoardMember = typeof boardMembers.$inferInsert;