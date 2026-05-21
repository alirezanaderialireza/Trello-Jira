// apps/web/src/features/board/store/sync/outbox/retryScheduler.ts
// ─────────────────────────────────────────────────────────────────────────────
// Retry Scheduler — drives the durable outbox processing loop.
//
// Runs on a timer (every POLL_INTERVAL_MS).
// For each pending/retrying mutation whose nextRetryAt ≤ now:
//   1. Mark as "sent" in IDB
//   2. Call the registered send function
//   3. On success  → mark acked
//   4. On failure  → schedule retry with exponential backoff + jitter
//                  → after maxRetries → move to DLQ
// ─────────────────────────────────────────────────────────────────────────────

import type { IndexedDbOutbox, PersistedMutation } from "./indexedDbOutbox";

const POLL_INTERVAL_MS    = 500;
const BASE_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS  = 30_000;
const JITTER              = 0.3;

function calcDelay(retryCount: number): number {
  const exp    = Math.min(BASE_RETRY_DELAY_MS * 2 ** retryCount, MAX_RETRY_DELAY_MS);
  const jitter = exp * JITTER * (Math.random() * 2 - 1);
  return Math.round(exp + jitter);
}

export type SendFn = (mutation: PersistedMutation) => Promise<void>;

export class RetryScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly outbox: IndexedDbOutbox,
    private readonly send: SendFn,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), POLL_INTERVAL_MS);
    // immediate first tick
    this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.running) return; // prevent overlapping ticks
    this.running = true;
    try {
      const pending = await this.outbox.getPending();
      const now     = Date.now();
      for (const mut of pending) {
        if (mut.nextRetryAt !== null && mut.nextRetryAt > now) continue;
        await this.processMutation(mut);
      }
    } finally {
      this.running = false;
    }
  }

  private async processMutation(mut: PersistedMutation): Promise<void> {
    await this.outbox.update(mut.correlationId, { status: "sent" });
    try {
      await this.send(mut);
      await this.outbox.markAcked(mut.correlationId);
    } catch (err: unknown) {
      const newCount = mut.retryCount + 1;
      if (newCount >= mut.maxRetries) {
        await this.outbox.moveToDlq(mut, (err as Error)?.message ?? "max retries exceeded");
      } else {
        await this.outbox.update(mut.correlationId, {
          status:      "retrying",
          retryCount:  newCount,
          nextRetryAt: Date.now() + calcDelay(newCount),
          lastError:   { code: "SEND_FAILED", message: (err as Error)?.message ?? "unknown" },
        });
      }
    }
  }
}
