// packages/db/src/schema/workspaces.ts

import { pgTable, uuid, varchar, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 100 }).notNull(),
    slug: varchar("slug", { length: 60 }).notNull(),
    tier: varchar("tier", { length: 20 }).notNull().default("free"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "restrict" }).notNull(),
    personalForUserId: uuid("personal_for_user_id").references(() => users.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    slugUniqueIdx: uniqueIndex("idx_workspaces_slug_unique")
      .on(table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
    ownerIdx: index("idx_workspaces_owner").on(table.ownerId),
  })
);

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
