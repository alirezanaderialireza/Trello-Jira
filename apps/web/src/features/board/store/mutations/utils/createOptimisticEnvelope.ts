// apps/web/src/features/board/store/mutations/utils/createOptimisticEnvelope.ts

import crypto from "node:crypto";
import type { DomainEvent, DomainEventType } from "@repo/domain";
import type { ClientEventEnvelope } from "../../event-application/types";

/**
 * 🚀 Optimistic Event Factory (The Envelope Builder)
 * تولید رویداد استاندارد کلاینت مطابق با ساختار Domain Event
 */
export function createOptimisticEnvelope<
  TEvent extends DomainEvent<DomainEventType, any>
>(
  type: TEvent["type"],
  payload: TEvent["payload"],
  aggregateId: string,
  aggregateType: TEvent["aggregateType"],
  currentRevision: number,
  correlationId: string
): ClientEventEnvelope {
  
  const event: TEvent = {
    id: crypto.randomUUID(),
    type,
    version: currentRevision === 0 ? 1 : currentRevision + 1,
    occurredAt: new Date().toISOString(),
    schemaVersion: 1,
    aggregateId,
    aggregateType,
    correlationId,
    payload,
  } as TEvent;

  return {
    event,
    optimistic: true,
    acknowledged: false,
  };
}