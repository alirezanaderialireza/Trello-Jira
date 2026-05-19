// apps/web/src/features/board/store/sync/connection/actorMailbox.ts
// ─────────────────────────────────────────────────────────────────────────────
// Actor Mailbox — serialized, ordered message queue.
//
// Guarantees:
//   • Messages are processed ONE AT A TIME (no concurrent processing)
//   • Ordering is preserved (FIFO)
//   • Processor errors are caught → do NOT stop the queue
//   • While processing, new messages are buffered and processed after
//
// This is the core primitive that makes ConnectionActor race-condition free:
// no two socket events can be processed concurrently.
// ─────────────────────────────────────────────────────────────────────────────

export type MessageProcessor<T> = (msg: T) => void | Promise<void>;

export class ActorMailbox<T> {
  private queue:      T[]  = [];
  private processing = false;

  constructor(private readonly process: MessageProcessor<T>) {}

  /** Enqueue a message. Returns immediately — processing is async + serial. */
  send(msg: T): void {
    this.queue.push(msg);
    if (!this.processing) this.drain();
  }

  /** Current queue depth (for backpressure metrics) */
  get depth(): number { return this.queue.length; }

  /** Flush remaining messages (for testing / graceful shutdown) */
  async flush(): Promise<void> {
    while (this.queue.length > 0 || this.processing) {
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }

  /** Drop all queued (but not yet processing) messages */
  clear(): void { this.queue = []; }

  private async drain(): Promise<void> {
    this.processing = true;
    while (this.queue.length > 0) {
      const msg = this.queue.shift()!;
      try {
        await this.process(msg);
      } catch (err) {
        // Processor crash is isolated — queue continues
        if (process.env.NODE_ENV !== "production") {
          console.error("[ActorMailbox] Processor error:", err);
        }
      }
    }
    this.processing = false;
  }
}
