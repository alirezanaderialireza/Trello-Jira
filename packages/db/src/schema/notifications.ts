// packages/db/src/schema/notifications.ts
//
// Phase 1.2 (F1.2.9) — notifications inbox table.
// Mirrors migration 0014. One row per recipient per event.
//
// RLS is USER + TENANT scoped (see migration): a user only sees their own
// notifications. Rows are written by the outbox-worker under a BYPASSRLS
// service role.
//
// No relations() — declared-but-unused Drizzle relations crash at runtime.
//
// user_id / actor_id are varchar(128) (text form of the user uuid) with NO
// cross-type FK to users(id uuid) — matches attachments.uploaded_by.

import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const notifications = pgTable(
  "notifications",
  {
    id:         uuid("id").primaryKey().defaultRandom(),
    tenantId:   uuid("tenant_id").notNull(),
    // recipient
    userId:     varchar("user_id", { length: 128 }).notNull(),
    type:       varchar("type", { length: 64 }).notNull(),
    entityType: varchar("entity_type", { length: 32 }).notNull().default("card"),
    entityId:   uuid("entity_id").notNull(),
    boardId:    uuid("board_id"),
    cardId:     uuid("card_id"),
    actorId:    varchar("actor_id", { length: 128 }).notNull(),
    actorName:  varchar("actor_name", { length: 255 }),
    title:      varchar("title", { length: 255 }).notNull(),
    body:       text("body"),
    readAt:     timestamp("read_at", { withTimezone: true }),
    createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    unreadIdx: index("idx_notifications_unread")
                 .on(table.userId, table.tenantId, table.createdAt)
                 .where(sql`${table.readAt} IS NULL`),
    allIdx:    index("idx_notifications_all")
                 .on(table.userId, table.tenantId, table.createdAt),
  }),
);

export type Notification    = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
