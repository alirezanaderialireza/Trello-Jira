// packages/db/src/schema/attachments.ts
//
// Phase 1.2 (F1.2.8) — Attachments table.
// Mirrors migration 0011. Two attachment types:
//   "file" — uploaded to R2/MinIO via pre-signed PUT.
//   "link" — external URL added directly (no upload).
//
// No relations() — same lesson as checklists (F1.2.3.a): declared-but-unused
// Drizzle relations crash at runtime when referenced inside router queries.

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

export const attachments = pgTable(
  "attachments",
  {
    id:         uuid("id").primaryKey().defaultRandom(),
    tenantId:   uuid("tenant_id").notNull(),
    cardId:     uuid("card_id")
                  .references(() => cards.id, { onDelete: "cascade" })
                  .notNull(),
    boardId:    uuid("board_id").notNull(),
    // "file" | "link"
    type:       varchar("type", { length: 10 }).notNull().default("file"),
    url:        text("url").notNull(),
    objectKey:  text("object_key"),
    mimeType:   varchar("mime_type", { length: 128 }),
    fileName:   varchar("file_name", { length: 255 }).notNull(),
    sizeBytes:  integer("size_bytes"),
    title:      varchar("title", { length: 255 }),
    // varchar(128) — matches users.id type (mirrors comments.author_id)
    uploadedBy: varchar("uploaded_by", { length: 128 }).notNull(),
    createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt:  timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    cardIdx:   index("idx_attachments_card")
                 .on(table.cardId, table.tenantId)
                 .where(sql`${table.deletedAt} IS NULL`),
    tenantIdx: index("idx_attachments_tenant")
                 .on(table.tenantId)
                 .where(sql`${table.deletedAt} IS NULL`),
  }),
);

export type Attachment    = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;
