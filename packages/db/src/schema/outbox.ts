import { pgTable, uuid, varchar, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ============================================================================
// 🗄️ Outbox Events Table
// ============================================================================
// وظیفه: ذخیره رویدادهای منتشر نشده (یا منتشرشده) برای event sourcing / outbox pattern
// تضمین می‌کند که تمام تغییرات در Aggregateها با ترتیب و sequence صحیح ثبت شوند.
// ============================================================================

export const outboxEvents = pgTable(
  "outbox_events",
  {
    // =========================================================================
    // 🔹 Identity
    // =========================================================================
    eventId: uuid("event_id").primaryKey().defaultRandom(),

    // =========================================================================
    // 🔹 Schema Version
    // =========================================================================
    eventVersion: varchar("event_version", { length: 32 }).notNull(),

    // =========================================================================
    // 🔹 Aggregate Reference
    // =========================================================================
    aggregateId: uuid("aggregate_id").notNull(), // رفرنس به Board, List یا Card
    aggregateType: varchar("aggregate_type", { length: 64 }).notNull(),

    // =========================================================================
    // 🔹 Event Metadata
    // =========================================================================
    type: varchar("type", { length: 128 }).notNull(),
    sequence: integer("sequence").notNull(),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),

    causationId: varchar("causation_id", { length: 128 }),
    correlationId: varchar("correlation_id", { length: 128 }),

    // =========================================================================
    // 🔹 Payload
    // =========================================================================
    payload: jsonb("payload").notNull(),

    // =========================================================================
    // 🔹 Processing State
    // =========================================================================
    processedAt: timestamp("processed_at"), // نال بودن یعنی هنوز پردازش نشده
  },
  (table) => ({
    // =========================================================================
    // 🔹 Indexes
    // =========================================================================
    unprocessedIdx: index("outbox_unprocessed_idx")
      .on(table.processedAt)
      .where(sql`${table.processedAt} IS NULL`),

    aggregateSequenceIdx: index("outbox_agg_seq_idx")
      .on(table.aggregateId, table.sequence),
  })
);

// =============================================================================
// Types
// =============================================================================
export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type NewOutboxEvent = typeof outboxEvents.$inferInsert;