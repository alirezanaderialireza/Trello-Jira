import { pgTable, uuid, varchar, jsonb, timestamp, index } from "drizzle-orm/pg-core";

// ============================================================================
// 🗄️ Audit Logs Table
// ============================================================================
// وظیفه: ثبت تمام اکشن‌های کاربران برای موجودیت‌های مختلف (Card, List, Board)
// ============================================================================

export const auditLogs = pgTable(
  "audit_logs",
  {
    // =========================================================================
    // 🔹 Primary Identity
    // =========================================================================
    id: uuid("id").primaryKey().defaultRandom(),

    // =========================================================================
    // 🔹 Actor & Tenant
    // =========================================================================
    actorId: uuid("actor_id").notNull(),      // کاربری که عملیات را انجام داده
    tenantId: uuid("tenant_id").notNull(),    // برای Tenant Isolation

    // =========================================================================
    // 🔹 Action Metadata
    // =========================================================================
    action: varchar("action", { length: 128 }).notNull(),
    entityId: uuid("entity_id").notNull(),    // موجودیت هدف (Card, List, Board)
    entityType: varchar("entity_type", { length: 64 }).notNull(),
    correlationId: varchar("correlation_id", { length: 128 }).notNull(), // برای تطبیق تراکنش‌ها

    // =========================================================================
    // 🔹 State Snapshots
    // =========================================================================
    beforeState: jsonb("before_state").notNull(),
    afterState: jsonb("after_state").notNull(),

    // =========================================================================
    // 🔹 Lifecycle
    // =========================================================================
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    // =========================================================================
    // 🔹 Indexes for fast queries
    // =========================================================================
    entityIdx: index("audit_entity_idx").on(table.entityId, table.entityType),
    tenantIdx: index("audit_tenant_idx").on(table.tenantId),
  })
);

// =============================================================================
// Types
// =============================================================================
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;