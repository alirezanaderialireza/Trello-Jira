// packages/db/src/schema/outbox.ts
//
// Fixes applied:
// ✅ BUG-011: sequence changed from integer (32-bit) to bigint.
//             At 100 events/sec, integer overflows in ~248 days.
// ✅ BUG-015: aggregateId changed from uuid to varchar(128).
//             UUID enforces a strict format at DB level. If any aggregate ever
//             uses cuid2 or a prefixed ID (e.g. "board_abc123"), INSERT fails.
//             varchar(128) is safe for UUIDs and any future ID format.

import {
  pgTable,
  uuid,
  varchar,
  bigint,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const outboxEvents = pgTable(
  "outbox_events",
  {
    // =========================================================================
    // Identity
    // =========================================================================
    eventId: uuid("event_id").primaryKey().defaultRandom(),

    // =========================================================================
    // Schema Version
    // =========================================================================
    eventVersion: varchar("event_version", { length: 32 }).notNull(),

    // =========================================================================
    // ✅ BUG-015: varchar instead of uuid — future-proof for non-UUID aggregate IDs
    // =========================================================================
    aggregateId:   varchar("aggregate_id",   { length: 128 }).notNull(),
    aggregateType: varchar("aggregate_type", { length: 64  }).notNull(),

    // =========================================================================
    // Event Metadata
    // =========================================================================
    type:      varchar("type",     { length: 128 }).notNull(),
    // ✅ BUG-011: bigint — no 32-bit overflow
    sequence:  bigint("sequence",  { mode: "number" }).notNull(),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),

    causationId:  varchar("causation_id",  { length: 128 }),
    correlationId: varchar("correlation_id", { length: 128 }),

    // =========================================================================
    // Payload
    // =========================================================================
    payload: jsonb("payload").notNull(),

    // =========================================================================
    // Processing State
    // =========================================================================
    processedAt: timestamp("processed_at"), // NULL = not yet processed
  },
  (table) => ({
    unprocessedIdx: index("outbox_unprocessed_idx")
      .on(table.processedAt)
      .where(sql`${table.processedAt} IS NULL`),

    aggregateSequenceIdx: index("outbox_agg_seq_idx")
      .on(table.aggregateId, table.sequence),
  }),
);

// =============================================================================
// Types
// =============================================================================
export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type NewOutboxEvent = typeof outboxEvents.$inferInsert;
