// apps/web/src/features/board/store/sync/finalization/ackLedger.ts
// ─────────────────────────────────────────────────────────────────────────────
// ACK Ledger — durable record of which mutations have been server-confirmed.
//
// Guarantees:
//   • Once a mutationId is in the ledger, duplicate ACKs are idempotent.
//   • Survived across browser refresh via sessionStorage (per-tab, per-board).
//   • Allows retry logic to detect "already ACK'd" before re-sending.
//   • Provides a delivery watermark: the highest sequence seen via ACK.
//
// Design:
//   • In-memory Map for O(1) hot lookups.
//   • sessionStorage mirror for crash/refresh recovery.
//   • Max 500 entries per board (ring-buffer eviction of oldest).
//   • Entries include serverSequence for causal ordering guarantees.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_ENTRIES = 500;
const STORAGE_KEY = (boardId: string) => `ackledger:${boardId}`;

export interface AckEntry {
  correlationId:  string;
  serverSequence: string;        // sequence assigned by server
  ackedAt:        number;        // unix ms
}

export class AckLedger {
  // ordered insertion map (JS Map preserves insertion order)
  private readonly ledger = new Map<string, AckEntry>();
  private watermark = "0"; // highest serverSequence ACK'd

  constructor(private readonly boardId: string) {
    this.load();
  }

  /** Returns true if this mutation has already been ACK'd (idempotency check) */
  isAcked(correlationId: string): boolean {
    return this.ledger.has(correlationId);
  }

  /** Record a new ACK. Idempotent — second call for same id is a no-op. */
  record(correlationId: string, serverSequence: string): void {
    if (this.ledger.has(correlationId)) return;

    this.ledger.set(correlationId, {
      correlationId, serverSequence, ackedAt: Date.now(),
    });

    // Update watermark
    if (BigInt(serverSequence) > BigInt(this.watermark)) {
      this.watermark = serverSequence;
    }

    // Evict oldest if over limit
    if (this.ledger.size > MAX_ENTRIES) {
      const oldest = this.ledger.keys().next().value as string;
      this.ledger.delete(oldest);
    }

    this.persist();
  }

  /** Highest server sequence confirmed so far */
  getWatermark(): string { return this.watermark; }

  /** All ACK'd correlationIds in insertion order */
  getAll(): AckEntry[] { return [...this.ledger.values()]; }

  /** Clear (e.g. on logout) */
  clear(): void {
    this.ledger.clear();
    this.watermark = "0";
    try { sessionStorage.removeItem(STORAGE_KEY(this.boardId)); } catch { /**/ }
  }

  private persist(): void {
    try {
      const data = { watermark: this.watermark, entries: [...this.ledger.values()] };
      sessionStorage.setItem(STORAGE_KEY(this.boardId), JSON.stringify(data));
    } catch { /* quota exceeded — memory-only fallback */ }
  }

  private load(): void {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY(this.boardId));
      if (!raw) return;
      const data = JSON.parse(raw) as { watermark: string; entries: AckEntry[] };
      this.watermark = data.watermark ?? "0";
      for (const e of data.entries ?? []) this.ledger.set(e.correlationId, e);
    } catch { /* corrupted storage — start fresh */ }
  }
}

// ── Singleton registry ────────────────────────────────────────────────────────
const registry = new Map<string, AckLedger>();

export function getAckLedger(boardId: string): AckLedger {
  if (!registry.has(boardId)) registry.set(boardId, new AckLedger(boardId));
  return registry.get(boardId)!;
}
export function destroyAckLedger(boardId: string): void {
  registry.get(boardId)?.clear();
  registry.delete(boardId);
}
