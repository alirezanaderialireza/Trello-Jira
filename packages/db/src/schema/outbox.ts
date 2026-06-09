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
    // 🔹 Multi-tenancy (H-04 / A-02)
    // =========================================================================
    // Tenant isolation column. Nullable at the type level because the value is
    // populated by the `app.outbox_set_tenant_id()` BEFORE INSERT trigger
    // (migration 0017) rather than by every call site — so existing
    // `outbox.append()` writers don't all need to thread tenantId. RLS
    // split-policies on this table fail closed when tenant_id is NULL.
    tenantId: uuid("tenant_id"),

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

    // ─────────────────────────────────────────────────────────────────────
    // Durable retry counter (added in migration 0005). Incremented by the
    // outbox worker after every failed publish. Survives worker restarts so
    // we honour OUTBOX_MAX_RETRIES even across process boundaries instead
    // of relying on a process-local Map (Bug #13).
    // ─────────────────────────────────────────────────────────────────────
    retryCount: integer("retry_count").notNull().default(0),
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

    // Tenant-scoped lookups (RLS filter + activity feed). See migration 0017.
    tenantIdx: index("outbox_tenant_idx").on(table.tenantId),
  })
);

// =============================================================================
// Types
// =============================================================================
export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type NewOutboxEvent = typeof outboxEvents.$inferInsert;