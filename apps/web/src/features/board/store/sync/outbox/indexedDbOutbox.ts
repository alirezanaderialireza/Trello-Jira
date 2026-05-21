// apps/web/src/features/board/store/sync/outbox/indexedDbOutbox.ts
// ─────────────────────────────────────────────────────────────────────────────
// IndexedDB-backed durable outbox.
//
// Schema:  IDB database "board-outbox", object store "mutations"
// Key:     correlationId (client-generated, stable across crashes)
//
// Guarantees:
//   • Mutations survive browser refresh / crash
//   • All writes are transactional (no partial state)
//   • Reads are sorted by createdAt (FIFO processing order)
//   • DLQ entries are stored in a separate "dlq" object store
// ─────────────────────────────────────────────────────────────────────────────

import type { BoardSnapshot } from "../../useBoardStore";

const DB_NAME      = "board-outbox";
const DB_VERSION   = 1;
const STORE_PENDING = "mutations";
const STORE_DLQ    = "dlq";

export type PersistedMutationStatus =
  | "queued" | "sent" | "retrying" | "acked" | "rolled_back" | "dead_lettered";

export interface PersistedMutation {
  correlationId:  string;
  eventType:      string;
  aggregateId:    string;
  eventPayload:   unknown;           // serialised ClientEventEnvelope.event
  rollbackSnapshot?: BoardSnapshot;
  status:         PersistedMutationStatus;
  retryCount:     number;
  maxRetries:     number;
  nextRetryAt:    number | null;      // unix ms
  createdAt:      number;
  updatedAt:      number;
  lastError?:     { code: string; message: string };
}

// ── IDB helpers ──────────────────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = (ev.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_PENDING)) {
        const store = db.createObjectStore(STORE_PENDING, { keyPath: "correlationId" });
        store.createIndex("by_status",    "status",     { unique: false });
        store.createIndex("by_createdAt", "createdAt",  { unique: false });
        store.createIndex("by_nextRetry", "nextRetryAt",{ unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_DLQ)) {
        db.createObjectStore(STORE_DLQ, { keyPath: "correlationId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

// ── IndexedDbOutbox ──────────────────────────────────────────────────────────

export class IndexedDbOutbox {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) this.dbPromise = openDb();
    return this.dbPromise;
  }

  /** Persist a new mutation (idempotent — overwrites if key exists) */
  async enqueue(mutation: PersistedMutation): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(STORE_PENDING, "readwrite");
    await idbRequest(tx.objectStore(STORE_PENDING).put(mutation));
  }

  /** Update status / retryCount / nextRetryAt of an existing record */
  async update(
    correlationId: string,
    changes: Partial<Pick<PersistedMutation, "status" | "retryCount" | "nextRetryAt" | "lastError" | "updatedAt">>,
  ): Promise<void> {
    const db  = await this.getDb();
    const tx  = db.transaction(STORE_PENDING, "readwrite");
    const st  = tx.objectStore(STORE_PENDING);
    const rec = await idbRequest<PersistedMutation | undefined>(st.get(correlationId));
    if (!rec) return;
    await idbRequest(st.put({ ...rec, ...changes, updatedAt: Date.now() }));
  }

  /** Get all pending/retrying mutations sorted by createdAt (FIFO) */
  async getPending(): Promise<PersistedMutation[]> {
    const db  = await this.getDb();
    const tx  = db.transaction(STORE_PENDING, "readonly");
    const all = await idbRequest<PersistedMutation[]>(tx.objectStore(STORE_PENDING).getAll());
    return all
      .filter((m) => m.status === "queued" || m.status === "sent" || m.status === "retrying")
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Get a single record */
  async get(correlationId: string): Promise<PersistedMutation | undefined> {
    const db = await this.getDb();
    const tx = db.transaction(STORE_PENDING, "readonly");
    return idbRequest(tx.objectStore(STORE_PENDING).get(correlationId));
  }

  /** Mark as ACK'd (keep for idempotency window, then purge) */
  async markAcked(correlationId: string): Promise<void> {
    await this.update(correlationId, { status: "acked", nextRetryAt: null });
  }

  /** Move to DLQ */
  async moveToDlq(mutation: PersistedMutation, reason: string): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction([STORE_PENDING, STORE_DLQ], "readwrite");
    tx.objectStore(STORE_PENDING).delete(mutation.correlationId);
    tx.objectStore(STORE_DLQ).put({ ...mutation, status: "dead_lettered", dlqReason: reason });
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror    = () => rej(tx.error);
    });
  }

  /** Purge ACK'd mutations older than `olderThanMs` ms */
  async purgeCompleted(olderThanMs: number): Promise<number> {
    const db   = await this.getDb();
    const tx   = db.transaction(STORE_PENDING, "readwrite");
    const all  = await idbRequest<PersistedMutation[]>(tx.objectStore(STORE_PENDING).getAll());
    const cutoff = Date.now() - olderThanMs;
    let purged = 0;
    for (const m of all) {
      if ((m.status === "acked" || m.status === "rolled_back") && m.updatedAt < cutoff) {
        tx.objectStore(STORE_PENDING).delete(m.correlationId);
        purged++;
      }
    }
    return purged;
  }

  /** Full clear (e.g. on logout) */
  async clear(): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction([STORE_PENDING, STORE_DLQ], "readwrite");
    tx.objectStore(STORE_PENDING).clear();
    tx.objectStore(STORE_DLQ).clear();
  }

  /** Get all DLQ entries */
  async getDlq(): Promise<PersistedMutation[]> {
    const db = await this.getDb();
    const tx = db.transaction(STORE_DLQ, "readonly");
    return idbRequest(tx.objectStore(STORE_DLQ).getAll());
  }
}

/** Module-level singleton */
let _outbox: IndexedDbOutbox | null = null;
export function getIndexedDbOutbox(): IndexedDbOutbox {
  if (!_outbox) _outbox = new IndexedDbOutbox();
  return _outbox;
}
