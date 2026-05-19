// apps/web/src/features/board/store/sync/replay/snapshotManager.ts
// ─────────────────────────────────────────────────────────────────────────────
// SnapshotManager — IDB-backed projection snapshot storage.
//
// Stores named snapshots keyed by (boardId, sequence).
// Used by IncrementalReplay to avoid replaying from sequence 0 every time.
//
// Schema:  IDB "board-snapshots"  objectStore "snapshots"
// Key:     `${boardId}:${sequence}`
// ─────────────────────────────────────────────────────────────────────────────

import type { BoardStoreState } from "../../useBoardStore";

const DB_NAME  = "board-snapshots";
const DB_VER   = 1;
const STORE    = "snapshots";
const MAX_SNAPS_PER_BOARD = 5;   // keep only the 5 most-recent

export interface StoredSnapshot {
  key:      string;   // `${boardId}:${sequence}`
  boardId:  string;
  sequence: string;
  state:    Pick<BoardStoreState, "lists" | "cards" | "cardsByList" | "listOrder">;
  savedAt:  number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (ev) => {
      const db = (ev.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: "key" });
        s.createIndex("by_board", "boardId", { unique: false });
        s.createIndex("by_savedAt", "savedAt", { unique: false });
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

function idbReq<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

export class SnapshotManager {
  private dbP: Promise<IDBDatabase> | null = null;
  private db(): Promise<IDBDatabase> { return (this.dbP ??= openDb()); }

  /** Persist a projection snapshot */
  async save(boardId: string, sequence: string, state: BoardStoreState): Promise<void> {
    const db = await this.db();
    const snap: StoredSnapshot = {
      key:      `${boardId}:${sequence}`,
      boardId, sequence,
      state:    { lists: state.lists, cards: state.cards,
                  cardsByList: state.cardsByList, listOrder: state.listOrder },
      savedAt:  Date.now(),
    };
    const tx = db.transaction(STORE, "readwrite");
    await idbReq(tx.objectStore(STORE).put(snap));
    await this.evictOld(db, boardId);
  }

  /** Retrieve the newest snapshot at or before `atSequence` */
  async load(boardId: string, atSequence: string): Promise<StoredSnapshot | null> {
    const db  = await this.db();
    const tx  = db.transaction(STORE, "readonly");
    const all = await idbReq<StoredSnapshot[]>(
      tx.objectStore(STORE).index("by_board").getAll(boardId),
    );
    const eligible = all
      .filter((s) => BigInt(s.sequence) <= BigInt(atSequence))
      .sort((a, b) => Number(BigInt(b.sequence) - BigInt(a.sequence)));
    return eligible[0] ?? null;
  }

  /** Most-recent snapshot for the board */
  async latest(boardId: string): Promise<StoredSnapshot | null> {
    const db  = await this.db();
    const tx  = db.transaction(STORE, "readonly");
    const all = await idbReq<StoredSnapshot[]>(
      tx.objectStore(STORE).index("by_board").getAll(boardId),
    );
    if (!all.length) return null;
    return all.sort((a, b) => Number(BigInt(b.sequence) - BigInt(a.sequence)))[0] ?? null;
  }

  /** Delete all snapshots for a board */
  async clearBoard(boardId: string): Promise<void> {
    const db  = await this.db();
    const tx  = db.transaction(STORE, "readwrite");
    const all = await idbReq<StoredSnapshot[]>(
      tx.objectStore(STORE).index("by_board").getAll(boardId),
    );
    for (const s of all) tx.objectStore(STORE).delete(s.key);
  }

  private async evictOld(db: IDBDatabase, boardId: string): Promise<void> {
    const tx  = db.transaction(STORE, "readwrite");
    const all = await idbReq<StoredSnapshot[]>(
      tx.objectStore(STORE).index("by_board").getAll(boardId),
    );
    if (all.length <= MAX_SNAPS_PER_BOARD) return;
    const sorted = all.sort((a, b) => Number(BigInt(a.sequence) - BigInt(b.sequence)));
    for (const old of sorted.slice(0, sorted.length - MAX_SNAPS_PER_BOARD)) {
      tx.objectStore(STORE).delete(old.key);
    }
  }
}

let _mgr: SnapshotManager | null = null;
export function getSnapshotManager(): SnapshotManager {
  return (_mgr ??= new SnapshotManager());
}
