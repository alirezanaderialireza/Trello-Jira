// apps/web/src/features/board/store/mutations/utils/createOptimisticEnvelope.ts
// ✅ Fix: removed `import crypto from "node:crypto"` — this file runs in the browser.
//         globalThis.crypto (Web Crypto API) is available in all modern browsers and
//         in Next.js edge/server runtimes, so no import is needed.

import type { DomainEvent, DomainEventType } from "@repo/domain";
import type { ClientEventEnvelope } from "../../event-application/types";

/**
 * 🚀 Optimistic Event Factory
 *
 * Builds a fully-typed ClientEventEnvelope from a domain event type + payload.
 * Runs in both browser and server (SSR) contexts — must NOT use Node.js built-ins.
 */
export function createOptimisticEnvelope<
  TEvent extends DomainEvent<DomainEventType, any>,
>(
  type: TEvent["type"],
  payload: TEvent["payload"],
  aggregateId: string,
  aggregateType: TEvent["aggregateType"],
  currentRevision: number,
  correlationId: string,
): ClientEventEnvelope {
  const event: TEvent = {
    id: globalThis.crypto.randomUUID(),
    type,
    // version = currentRevision + 1; if entity is brand new (revision 0) → version = 1
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
