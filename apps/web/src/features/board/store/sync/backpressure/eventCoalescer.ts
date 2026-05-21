// apps/web/src/features/board/store/sync/backpressure/eventCoalescer.ts
// ─────────────────────────────────────────────────────────────────────────────
// EventCoalescer — merges high-frequency events, keeping only the latest.
//
// Use cases:
//   cursor_move: 60 events/sec → only the newest position matters
//   typing:      keystroke-by-keystroke → only final text matters per user
//   presence:    heartbeats from same user → latest wins
//
// A coalescing key is derived per event. For cursor_move it is `cursor:${userId}`.
// Only one event per key is retained; new arrivals overwrite old.
//
// Events that should NOT be coalesced (mutations, replay, etc.) pass through
// with a unique key (their correlationId or eventId).
// ─────────────────────────────────────────────────────────────────────────────

export type CoalesceKeyFn<T> = (item: T) => string;

export class EventCoalescer<T> {
  /** key → latest item */
  private readonly map = new Map<string, T>();
  /** insertion-order keys (to preserve relative ordering on flush) */
  private readonly order: string[] = [];

  constructor(private readonly keyFn: CoalesceKeyFn<T>) {}

  /** Add or overwrite an item. Returns true if a previous item was replaced. */
  add(item: T): boolean {
    const key      = this.keyFn(item);
    const replaced = this.map.has(key);
    if (!replaced) this.order.push(key);
    this.map.set(key, item);
    return replaced;
  }

  /** Flush all coalesced items in insertion order, then clear */
  flush(): T[] {
    const result: T[] = [];
    for (const key of this.order) {
      const item = this.map.get(key);
      if (item !== undefined) result.push(item);
    }
    this.map.clear();
    this.order.length = 0;
    return result;
  }

  get size(): number { return this.map.size; }
  isEmpty(): boolean { return this.map.size === 0; }
  clear(): void { this.map.clear(); this.order.length = 0; }
}
