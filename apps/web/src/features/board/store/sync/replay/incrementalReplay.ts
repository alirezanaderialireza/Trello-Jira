// apps/web/src/features/board/store/sync/replay/incrementalReplay.ts
// ─────────────────────────────────────────────────────────────────────────────
// IncrementalReplay — windowed, snapshot-assisted, checkpoint-resumable replay.
//
// vs. the existing full-rebuild ReplayEngine:
//   Full rebuild:     always starts from seq 0, expensive for large boards.
//   Incremental:      starts from nearest IDB snapshot, fetches only the delta.
//
// Algorithm:
//   1. Check SnapshotManager for the latest snapshot ≤ targetSequence.
//   2. Check ReplayCheckpointStore for a resume point (crash recovery).
//   3. Start from max(snapshot.sequence, checkpoint.lastSequence).
//   4. Fetch events in pages (WINDOW_SIZE) via fetchJournal.
//   5. Apply each page through replayEngine.replayEvents().
//   6. Write checkpoint every CHECKPOINT_INTERVAL events.
//   7. After each page that crosses SNAPSHOT_INTERVAL events → save snapshot.
//   8. On completion → clear checkpoint, return final state.
// ─────────────────────────────────────────────────────────────────────────────

import { replayEvents, createEmptyBoardState } from "../replayEngine";
import type { JournalEntry, ReplayResult }       from "../replayEngine";
import type { BoardStoreState }                  from "../../useBoardStore";
import { getSnapshotManager }                    from "./snapshotManager";
import { getReplayCheckpointStore }              from "./replayCheckpointStore";
import { migrateJournalEntry }                   from "../eventSchemaVersioning";

const WINDOW_SIZE         = 200;  // events per fetch page
const SNAPSHOT_INTERVAL   = 500;  // save a new snapshot every N events applied

export interface IncrementalReplayOptions {
  boardId:      string;
  targetSequence?: string;          // replay up to this seq (default = "latest")
  fetchJournal: (params: {
    boardId:      string;
    fromSequence: string;
    limit:        number;
    abortSignal?: AbortSignal;
  }) => Promise<{ events: JournalEntry[]; hasMore: boolean; latestSequence: string }>;
  onProgress?: (info: { eventsApplied: number; currentSequence: string; phase: string }) => void;
  abortSignal?: AbortSignal;
}

export interface IncrementalReplayResult {
  success:         boolean;
  state:           BoardStoreState | null;
  eventsProcessed: number;
  startSequence:   string;
  finalSequence:   string;
  snapshotsUsed:   number;
  durationMs:      number;
  error?:          string;
  aborted:         boolean;
}

export async function runIncrementalReplay(
  opts: IncrementalReplayOptions,
): Promise<IncrementalReplayResult> {
  const t0           = performance.now();
  const snapMgr      = getSnapshotManager();
  const ckptStore    = getReplayCheckpointStore();

  // ── 1. Find best starting point ──────────────────────────────────────────
  const latest   = await snapMgr.latest(opts.boardId);
  const ckpt     = ckptStore.load(opts.boardId);
  const snapSeq  = latest?.sequence ?? "0";
  const ckptSeq  = ckpt?.lastSequence ?? "0";
  const startSeq = BigInt(snapSeq) >= BigInt(ckptSeq) ? snapSeq : ckptSeq;

  let currentState: BoardStoreState;
  let snapshotsUsed = 0;

  if (latest && BigInt(latest.sequence) >= BigInt(ckptSeq)) {
    // Restore from IDB snapshot
    currentState = {
      ...createEmptyBoardState(),
      ...latest.state,
      boardSequence: latest.sequence,
    };
    snapshotsUsed = 1;
  } else {
    currentState = createEmptyBoardState();
  }

  // ── 2. Fetch + replay in windows ─────────────────────────────────────────
  let fromSeq        = startSeq;
  let totalProcessed = ckpt?.eventsProcessed ?? 0;
  let hasMore        = true;

  while (hasMore) {
    if (opts.abortSignal?.aborted) {
      ckptStore.clear(opts.boardId);
      return { success: false, state: null, eventsProcessed: totalProcessed,
               startSequence: startSeq, finalSequence: currentState.boardSequence,
               snapshotsUsed, durationMs: Math.round(performance.now() - t0),
               error: "Aborted", aborted: true };
    }

    let page: Awaited<ReturnType<typeof opts.fetchJournal>>;
    try {
      page = await opts.fetchJournal({
        boardId: opts.boardId, fromSequence: fromSeq,
        limit: WINDOW_SIZE, abortSignal: opts.abortSignal,
      });
    } catch (err: unknown) {
      ckptStore.clear(opts.boardId);
      return { success: false, state: null, eventsProcessed: totalProcessed,
               startSequence: startSeq, finalSequence: currentState.boardSequence,
               snapshotsUsed, durationMs: Math.round(performance.now() - t0),
               error: (err as Error).message, aborted: false };
    }

    // Stop if we've reached the target sequence
    const filteredEvents = opts.targetSequence
      ? page.events.filter((e) => BigInt(e.sequence) <= BigInt(opts.targetSequence!))
      : page.events;

    if (filteredEvents.length > 0) {
      const result: ReplayResult = replayEvents(currentState, filteredEvents, {
        boardId:          opts.boardId,
        fromSequence:     fromSeq,
        snapshotInterval: 0,
        enableLog:        false,
        migrateEvent:     migrateJournalEntry,
      });
      currentState  = result.state;
      totalProcessed += result.eventsProcessed;

      // Checkpoint
      ckptStore.save(opts.boardId, currentState.boardSequence, totalProcessed);

      // Periodic snapshot
      if (totalProcessed % SNAPSHOT_INTERVAL < filteredEvents.length) {
        await snapMgr.save(opts.boardId, currentState.boardSequence, currentState);
        snapshotsUsed++;
      }

      opts.onProgress?.({ eventsApplied: totalProcessed,
                          currentSequence: currentState.boardSequence, phase: "replaying" });
    }

    hasMore  = page.hasMore && !opts.abortSignal?.aborted;
    fromSeq  = page.latestSequence;

    if (opts.targetSequence && BigInt(fromSeq) >= BigInt(opts.targetSequence)) break;
  }

  // ── 3. Save final snapshot + clear checkpoint ─────────────────────────────
  await snapMgr.save(opts.boardId, currentState.boardSequence, currentState);
  ckptStore.clear(opts.boardId);

  return { success: true, state: currentState, eventsProcessed: totalProcessed,
           startSequence: startSeq, finalSequence: currentState.boardSequence,
           snapshotsUsed, durationMs: Math.round(performance.now() - t0), aborted: false };
}
