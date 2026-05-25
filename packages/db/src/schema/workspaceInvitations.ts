// packages/db/src/schema/workspaceInvitations.ts

import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { workspaces } from "./workspaces";

// ─────────────────────────────────────────────────────────────────────────────
// `role` is type-narrowed to the invitation-specific subset of WorkspaceRole.
// 'OWNER' is intentionally absent — ownership is transferred via a separate
// flow, never invited. The Persian UI label for VIEWER is "ناظر".
//
// Keep this union, the SQL CHECK in migration
// 0006_phase11_shell_foundation.sql, and the application-layer Zod
// validator in sync.
// ─────────────────────────────────────────────────────────────────────────────
export type WorkspaceInvitationRole = "ADMIN" | "MEMBER" | "VIEWER";

// ─────────────────────────────────────────────────────────────────────────────
// workspace_invitations
//
// Token-based invite flow:
//   • create  — admin/owner of workspace creates a row with crypto-random
//               64-char base64url token and 7-day default expiry.
//   • lookup  — by token (accept page) or by email (cross-workspace user
//               surface on login).
//   • mark    — accepted_at / accepted_by_user_id  -or-  revoked_at /
//               revoked_by_user_id — never both (CHECK invariant).
//
// Mirrors the table created in migration
// 0006_phase11_shell_foundation.sql.
// ─────────────────────────────────────────────────────────────────────────────

export const workspaceInvitations = pgTable(
  "workspace_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    invitedEmail: varchar("invited_email", { length: 254 }).notNull(),
    invitedUserId: uuid("invited_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    invitedByUserId: uuid("invited_by_user_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    role: varchar("role", { length: 20 })
      .$type<WorkspaceInvitationRole>()
      .notNull(),
    token: varchar("token", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByUserId: uuid("revoked_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenUniqueIdx: uniqueIndex("idx_invitations_token_unique").on(table.token),
    activeEmailWorkspaceUniqueIdx: uniqueIndex(
      "idx_invitations_active_email_workspace_unique",
    )
      .on(sql`lower(${table.invitedEmail})`, table.workspaceId)
      .where(sql`${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL`),
    pendingWorkspaceIdx: index("idx_invitations_pending_workspace")
      .on(table.workspaceId)
      .where(sql`${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL`),
    emailIdx: index("idx_invitations_email")
      .on(sql`lower(${table.invitedEmail})`)
      .where(sql`${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL`),
    tenantIdx: index("idx_invitations_tenant").on(table.tenantId),
  }),
);

export type WorkspaceInvitation = typeof workspaceInvitations.$inferSelect;
export type NewWorkspaceInvitation = typeof workspaceInvitations.$inferInsert;
