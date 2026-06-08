// packages/db/src/schema/cardWatchers.ts
//
// Phase 1.2 (F1.2.9) — card_watchers junction table.
//
// Mirrors migration 0014. Composite PK (card_id, user_id) — no synthetic id.
// tenant_id denormalised for RLS (same pattern as card_assignees).
// A user becomes a watcher automatically when they create a card or comment
// (see card / comments routers), or explicitly via notification.watchCard.
//
// No relations() — same lesson as checklists / cardAssignees: declared-but-
// unused Drizzle relations crash at runtime when referenced inside queries.
//
// user_id is varchar(128) (text form of the user uuid) with NO cross-type FK
// to users(id uuid) — matches attachments.uploaded_by.

import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { cards } from "./cards";

export const cardWatchers = pgTable(
  "card_watchers",
  {
    cardId:    uuid("card_id")
                 .references(() => cards.id, { onDelete: "cascade" })
                 .notNull(),
    userId:    varchar("user_id", { length: 128 }).notNull(),
    tenantId:  uuid("tenant_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
                 .notNull()
                 .defaultNow(),
  },
  (table) => ({
    pk:      primaryKey({ columns: [table.cardId, table.userId] }),
    userIdx: index("idx_card_watchers_user").on(table.userId, table.tenantId),
    cardIdx: index("idx_card_watchers_card").on(table.cardId, table.tenantId),
  }),
);

export type CardWatcher    = typeof cardWatchers.$inferSelect;
export type NewCardWatcher = typeof cardWatchers.$inferInsert;
