// packages/db/src/schema/workspaceMembers.ts

import { pgTable, uuid, varchar, timestamp, primaryKey, index } from "drizzle-orm/pg-core";
import type { WorkspaceRole } from "@repo/domain/workspaces";
import { workspaces } from "./workspaces";
import { users } from "./users";

// ─────────────────────────────────────────────────────────────────────────────
// workspace_members
//
// `role` is type-narrowed to the domain `WorkspaceRole` enum so callers cannot
// silently insert e.g. "SUPERADMIN" without TypeScript flagging it. The DB
// itself ENFORCES the same set via a CHECK constraint added in migration 0003,
// so even a raw SQL insert is rejected. The two layers must stay in sync —
// see packages/domain/src/workspaces/index.ts for the canonical list.
// ─────────────────────────────────────────────────────────────────────────────

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    role: varchar("role", { length: 20 }).$type<WorkspaceRole>().notNull().default("MEMBER"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.userId] }),
    userIdx: index("idx_workspace_members_user").on(table.userId),
  })
);

export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert;
