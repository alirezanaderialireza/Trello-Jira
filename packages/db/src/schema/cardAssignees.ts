// packages/db/src/schema/cardAssignees.ts
//
// Phase 1.2 (F1.2.5) — card_assignees junction table.
//
// Mirrors migration 0013. Composite PK (card_id, user_id) — no synthetic id.
// tenant_id denormalised for RLS (same pattern as card_labels, checklist_items).
// assigned_by + assigned_at for audit trail.
//
// No relations() — same lesson as checklists (F1.2.3.a): declared-but-unused
// Drizzle relations crash at runtime when referenced inside router queries.

import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { cards }  from "./cards";

export const cardAssignees = pgTable(
  "card_assignees",
  {
    cardId:     uuid("card_id")
                  .references(() => cards.id, { onDelete: "cascade" })
                  .notNull(),
    // user_id / assigned_by hold Auth.js subject IDs as varchar(128) with NO
    // FK to users(id): users.id is a uuid, so a varchar->uuid FK is a type
    // mismatch Postgres rejects (broke `drizzle-kit migrate` on a fresh DB).
    // Same no-FK pattern as boardMembers, comments.authorId, cardWatchers.
    userId:     varchar("user_id", { length: 128 }).notNull(),
    tenantId:   uuid("tenant_id").notNull(),
    assignedBy: varchar("assigned_by", { length: 128 }).notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
                  .notNull()
                  .defaultNow(),
  },
  (table) => ({
    pk:        primaryKey({ columns: [table.cardId, table.userId] }),
    // "My Cards" reverse lookup for F1.5.
    userIdx:   index("idx_card_assignees_user").on(table.tenantId, table.userId),
    tenantIdx: index("idx_card_assignees_tenant").on(table.tenantId),
  }),
);

export type CardAssignee    = typeof cardAssignees.$inferSelect;
export type NewCardAssignee = typeof cardAssignees.$inferInsert;
