// apps/outbox-worker/src/types.ts
//
// Shared types for the outbox worker and its event handlers.
// Extracted into a separate module so `handlers/*` can import them
// without creating a circular dependency with `index.ts`.

/**
 * Row shape returned by the FOR UPDATE SKIP LOCKED claim query in
 * `pollOnce`. Mirrors the public columns of `outbox_events`.
 */
export interface ClaimedEvent {
  event_id: string;
  aggregate_id: string;
  aggregate_type: string;
  type: string;
  sequence: number;
  payload: Record<string, unknown>;
  correlation_id: string | null;
  occurred_at: string;
  event_version: string;
  retry_count: number;
}

/**
 * Context passed to a per-event-type handler. Handlers run inside
 * the same transaction that holds the row claim, so any DB queries
 * they make (`tx.execute(sql\`...\`)`) participate in the same
 * crash-consistent unit as the claim + processed_at update.
 *
 * Why `tx: unknown`:
 *   The drizzle PostgresJsTransaction type is generic over the
 *   schema, and exposing it across module boundaries pulls in heavy
 *   type-checking work. Existing code in `index.ts` already passes
 *   the tx as `any`. We keep `unknown` here to be honest with
 *   handler authors: `tx` is opaque and must be re-typed at the
 *   call-site (the handler casts to the local drizzle helper it
 *   needs, e.g. `tx as { execute: (q: SQL) => Promise<...> }`).
 */
export interface EventHandlerContext {
  tx: unknown;
  event: ClaimedEvent;
}

export type EventHandler = (ctx: EventHandlerContext) => Promise<void>;
