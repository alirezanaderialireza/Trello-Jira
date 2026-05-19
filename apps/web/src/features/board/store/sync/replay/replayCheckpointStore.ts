// apps/web/src/features/board/store/sync/replay/replayCheckpointStore.ts
// ─────────────────────────────────────────────────────────────────────────────
// ReplayCheckpointStore — lightweight sessionStorage record of replay progress.
//
// On a long replay (thousands of events), if the tab crashes mid-way, the
// next attempt can resume from the last checkpoint instead of sequence 0.
//
// A checkpoint is written every CHECKPOINT_INTERVAL events during replay.
// On completion / abort, the checkpoint is cleared.
// ─────────────────────────────────────────────────────────────────────────────

const CHECKPOINT_INTERVAL = 200;
const KEY = (boardId: string) => `replay_ckpt:${boardId}`;

export interface ReplayCheckpoint {
  boardId:         string;
  lastSequence:    string;
  eventsProcessed: number;
  startedAt:       number;
  updatedAt:       number;
}

export class ReplayCheckpointStore {
  save(boardId: string, lastSequence: string, eventsProcessed: number): void {
    if (eventsProcessed % CHECKPOINT_INTERVAL !== 0) return;
    try {
      const existing = this.load(boardId);
      sessionStorage.setItem(KEY(boardId), JSON.stringify({
        boardId, lastSequence, eventsProcessed,
        startedAt:  existing?.startedAt ?? Date.now(),
        updatedAt:  Date.now(),
      }));
    } catch { /**/ }
  }

  load(boardId: string): ReplayCheckpoint | null {
    try {
      const raw = sessionStorage.getItem(KEY(boardId));
      return raw ? JSON.parse(raw) as ReplayCheckpoint : null;
    } catch { return null; }
  }

  clear(boardId: string): void {
    try { sessionStorage.removeItem(KEY(boardId)); } catch { /**/ }
  }
}

let _store: ReplayCheckpointStore | null = null;
export function getReplayCheckpointStore(): ReplayCheckpointStore {
  return (_store ??= new ReplayCheckpointStore());
}
