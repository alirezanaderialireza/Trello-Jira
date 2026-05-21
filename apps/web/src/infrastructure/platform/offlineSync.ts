// apps/web/src/infrastructure/platform/offlineSync.ts
// Client-side offline persistence + incremental replay coordination.
// Uses IndexedDB (via abstract storage interface) for durable state.

import type { BoardStoreState } from "../../features/board/store/useBoardStore";
import { computeChecksumSync, type Checksum } from "../../features/board/store/sync/canonicalSerializer";
import { telemetry } from "../../features/board/devtools/logEvent";

export interface OfflineSnapshot { state: BoardStoreState; sequence: string; checksum: Checksum; savedAt: string; }
export interface PendingOfflineOp { id: string; type: string; payload: unknown; createdAt: number; }

export interface OfflineStorage {
  getSnapshot(boardId: string): Promise<OfflineSnapshot | null>;
  saveSnapshot(boardId: string, snapshot: OfflineSnapshot): Promise<void>;
  getPendingOps(boardId: string): Promise<PendingOfflineOp[]>;
  addPendingOp(boardId: string, op: PendingOfflineOp): Promise<void>;
  removePendingOp(boardId: string, opId: string): Promise<void>;
  clearPendingOps(boardId: string): Promise<void>;
}

export class OfflineSyncManager {
  private storage: OfflineStorage;
  private boardId: string | null = null;
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  private readonly SAVE_INTERVAL = 30_000;

  constructor(storage: OfflineStorage) { this.storage = storage; }

  init(boardId: string): void {
    this.boardId = boardId;
    this.saveTimer = setInterval(() => this._autoSave(), this.SAVE_INTERVAL);
    telemetry.log("STORE", "OFFLINE_SYNC_INIT", { boardId });
  }

  destroy(): void {
    if (this.saveTimer) clearInterval(this.saveTimer);
    this.saveTimer = null;
  }

  async saveState(state: BoardStoreState): Promise<void> {
    if (!this.boardId) return;
    const checksum = computeChecksumSync(state);
    const snapshot: OfflineSnapshot = { state, sequence: state.boardSequence, checksum, savedAt: new Date().toISOString() };
    await this.storage.saveSnapshot(this.boardId, snapshot);
    telemetry.log("STORE", "OFFLINE_SNAPSHOT_SAVED", { boardId: this.boardId, sequence: state.boardSequence });
  }

  async loadState(): Promise<OfflineSnapshot | null> {
    if (!this.boardId) return null;
    const snapshot = await this.storage.getSnapshot(this.boardId);
    if (!snapshot) return null;
    // Verify integrity
    const current = computeChecksumSync(snapshot.state);
    if (current.hash !== snapshot.checksum.hash) {
      telemetry.log("STORE", "OFFLINE_SNAPSHOT_CORRUPT", { boardId: this.boardId });
      return null;
    }
    return snapshot;
  }

  async enqueuePendingOp(op: PendingOfflineOp): Promise<void> {
    if (!this.boardId) return;
    await this.storage.addPendingOp(this.boardId, op);
  }

  async getPendingOps(): Promise<PendingOfflineOp[]> {
    if (!this.boardId) return [];
    return this.storage.getPendingOps(this.boardId);
  }

  async clearPendingOps(): Promise<void> {
    if (!this.boardId) return;
    await this.storage.clearPendingOps(this.boardId);
  }

  private async _autoSave(): Promise<void> {
    // Auto-save is triggered externally by passing current state
    // This is a placeholder for the interval-based trigger.
  }
}
