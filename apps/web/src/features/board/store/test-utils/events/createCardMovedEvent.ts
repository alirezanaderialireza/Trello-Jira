import type { CardMovedEvent } from "@repo/domain";
import type { ClientEventEnvelope } from "../../../store/event-application/types";

export function createCardMovedEnvelope(
  payload: CardMovedEvent["payload"],
  overrides?: Partial<CardMovedEvent>,
  optimistic: boolean = false
): ClientEventEnvelope<CardMovedEvent> {
  return {
    event: {
      id: overrides?.id ?? `evt-${Math.random().toString(36).substr(2, 9)}`,
      type: "card.moved",
      version: overrides?.version ?? 2,
      schemaVersion: overrides?.schemaVersion ?? 1, // 🌟 پشتیبانی از تکامل
      occurredAt: overrides?.occurredAt ?? new Date().toISOString(),
      aggregateId: payload.cardId,
      aggregateType: "card",
      sequence: overrides?.sequence ?? 1,
      actorId: overrides?.actorId ?? "test-user",
      tenantId: overrides?.tenantId ?? "test-workspace",
      correlationId: overrides?.correlationId ?? "test-corr-id",
      payload,
    },
    optimistic,
  };
}