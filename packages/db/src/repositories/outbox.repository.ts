// packages/db/src/repositories/outbox.repository.ts

import type { DbTx } from "./board.repository";
import type { OutboxRepository, OutboxEvent } from "@repo/domain";
import { outboxEvents } from "../schema";

// ============================================================================
// DrizzleOutboxRepository (Enterprise-Grade)
// ============================================================================
export class DrizzleOutboxRepository implements OutboxRepository<DbTx> {
  constructor(private readonly db: DbTx) {}

  // ========================================================================
  // Append an Outbox Event
  // ========================================================================
  async append(tx: DbTx, event: OutboxEvent): Promise<void> {
    await tx.insert(outboxEvents).values({
      eventId: event.eventId,
      eventVersion: event.eventVersion ?? "v1", // 🌟 پیش‌فرض نسخه
      aggregateId: event.aggregateId,
      aggregateType: event.aggregateType,
      type: event.type,
      sequence: event.sequence ?? 0,            // 🌟 پیش‌فرض sequence
      occurredAt: event.occurredAt ?? new Date(),
      causationId: event.causationId ?? null,
      correlationId: event.correlationId ?? null,
      payload: event.payload,
    });
  }
}