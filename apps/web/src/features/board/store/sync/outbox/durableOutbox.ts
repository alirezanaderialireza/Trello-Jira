// apps/web/src/features/board/store/sync/outbox/durableOutbox.ts
// ─────────────────────────────────────────────────────────────────────────────
// DurableOutbox — public API combining IDB storage + retry scheduler.
//
// Usage:
//   const outbox = getDurableOutbox();
//   outbox.setSendFn(async (mut) => { await trpc.card.move.mutate(...) });
//   outbox.start();               // begin processing loop
//   outbox.enqueue(mutation);     // persist + schedule
//   outbox.ack(correlationId);    // mark success
//   outbox.stop();                // clean shutdown
// ─────────────────────────────────────────────────────────────────────────────

import { IndexedDbOutbox, getIndexedDbOutbox } from "./indexedDbOutbox";
import { RetryScheduler, SendFn }              from "./retryScheduler";
import type { BoardSnapshot }                  from "../../useBoardStore";
import type { PersistedMutation }              from "./indexedDbOutbox";

export type { PersistedMutation, PersistedMutationStatus } from "./indexedDbOutbox";

export interface EnqueueOptions {
  correlationId:   string;
  eventType:       string;
  aggregateId:     string;
  eventPayload:    unknown;
  rollbackSnapshot?: BoardSnapshot;
  maxRetries?:     number;
}

export class DurableOutbox {
  private readonly store: IndexedDbOutbox;
  private scheduler: RetryScheduler | null = null;

  constructor(store?: IndexedDbOutbox) {
    this.store = store ?? getIndexedDbOutbox();
  }

  /** Register the function that actually sends a mutation to the server */
  setSendFn(fn: SendFn): void {
    this.scheduler = new RetryScheduler(this.store, fn);
  }

  start(): void  { this.scheduler?.start(); }
  stop():  void  { this.scheduler?.stop(); }

  async enqueue(opts: EnqueueOptions): Promise<void> {
    const mut: PersistedMutation = {
      correlationId:   opts.correlationId,
      eventType:       opts.eventType,
      aggregateId:     opts.aggregateId,
      eventPayload:    opts.eventPayload,
      rollbackSnapshot: opts.rollbackSnapshot,
      status:          "queued",
      retryCount:      0,
      maxRetries:      opts.maxRetries ?? 3,
      nextRetryAt:     null,
      createdAt:       Date.now(),
      updatedAt:       Date.now(),
    };
    await this.store.enqueue(mut);
  }

  async ack(correlationId: string): Promise<void> {
    await this.store.markAcked(correlationId);
  }

  /** Load all pending mutations on startup (crash recovery) */
  async recoverPending(): Promise<PersistedMutation[]> {
    return this.store.getPending();
  }

  async getDlq(): Promise<PersistedMutation[]> {
    return this.store.getDlq();
  }

  async purge(olderThanMs = 5 * 60_000): Promise<number> {
    return this.store.purgeCompleted(olderThanMs);
  }
}

let _instance: DurableOutbox | null = null;
export function getDurableOutbox(): DurableOutbox {
  if (!_instance) _instance = new DurableOutbox();
  return _instance;
}
export function resetDurableOutbox(): void {
  _instance?.stop();
  _instance = null;
}
