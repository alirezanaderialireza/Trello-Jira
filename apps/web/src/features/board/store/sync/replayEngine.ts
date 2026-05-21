// apps/web/src/features/board/store/sync/replayEngine.ts
// -----------------------------------------------------------------------------
// Deterministic Replay Engine.
//
// Rebuilds board projection state from an ordered event journal.
// Used for:
//   - Full state rebuild after gap_unrecoverable / resync
//   - Debug: reconstruct exact state at any sequence point
//   - Projection verification: compare replayed vs live state
//   - Board/tenant-level rebuild from server event history
//
// Design:
//   - Pure function core — no side effects, fully testable
//   - Dual-revision support: tracks both entity revision AND board sequence
//   - Snapshot checkpointing: periodically captures intermediate state
//   - Replay log: records every applied event with timing + delta
//   - Idempotent: re-applying same event is a no-op (sequence guard)
//   - Schema-version aware: delegates to EventSchemaVersioning for migration
// -----------------------------------------------------------------------------

import type { AppDomainEvent } from "@repo/domain";
import type { BoardStoreState, CardDto, ListDto } from "../useBoardStore";
import type { ClientEventEnvelope } from "../event-application/types";
import type { ReducerContext } from "../event-application/context";
import { applyEvent as dispatcherApplyEvent } from "../event-application/dispatcher";

// ============================================================================
// Types
// ============================================================================

/** A single event from the server event journal */
export interface JournalEntry {
  eventId: string;
  type: string;
  sequence: string;
  payload: AppDomainEvent;
  occurredAt: string | Date;
  correlationId?: string;
  causationId?: string;
  eventVersion?: string;
}

/** Configuration for a replay session */
export interface ReplayConfig {
  /** Board ID being replayed */
  boardId: string;
  /** Starting sequence (exclusive — replay events AFTER this) */
  fromSequence?: string;
  /** Ending sequence (inclusive — replay up to this) */
  toSequence?: string;
  /** Capture snapshot every N events (0 = disabled) */
  snapshotInterval: number;
  /** Enable detailed replay log (for debugging) */
  enableLog: boolean;
  /** Schema migration function (optional — from EventSchemaVersioning) */
  migrateEvent?: (entry: JournalEntry) => JournalEntry;
  /** Abort signal for long replays */
  abortSignal?: AbortSignal;
}

/** A single entry in the replay log */
export interface ReplayLogEntry {
  sequence: string;
  eventType: string;
  eventId: string;
  appliedAt: number; // unix ms
  durationMs: number;
  entityId: string;
  revisionBefore: number | null;
  revisionAfter: number | null;
  boardSequenceBefore: string;
  boardSequenceAfter: string;
  skipped: boolean;
  skipReason?: string;
}

/** Intermediate snapshot captured during replay */
export interface ReplaySnapshot {
  sequence: string;
  capturedAt: number;
  state: Readonly<BoardStoreState>;
  eventsApplied: number;
}

/** Final result of a replay session */
export interface ReplayResult {
  success: boolean;
  /** Final rebuilt state */
  state: BoardStoreState;
  /** Total events processed */
  eventsProcessed: number;
  /** Events skipped (duplicate, out-of-range, migration failure) */
  eventsSkipped: number;
  /** Total replay duration in ms */
  durationMs: number;
  /** Final board sequence reached */
  finalSequence: string;
  /** Intermediate snapshots (if snapshotInterval > 0) */
  snapshots: ReplaySnapshot[];
  /** Detailed replay log (if enableLog = true) */
  log: ReplayLogEntry[];
  /** Error if replay failed */
  error?: string;
  /** Aborted by signal */
  aborted: boolean;
}

// ============================================================================
// Empty State Factory
// ============================================================================

export function createEmptyBoardState(): BoardStoreState {
  return {
    lists: {},
    cards: {},
    cardsByList: {},
    listOrder: [],
    boardSequence: "0",
    bufferedEvents: {},
    syncStatus: "healthy",
    pendingMutations: {},
  };
}

// ============================================================================
// Replay Engine — Core Pure Function
// ============================================================================

/**
 * Deterministically replays a sequence of journal entries to produce
 * a fully reconstructed BoardStoreState.
 *
 * This is the heart of the system's eventual consistency guarantee:
 * given the same event journal in the same order, the output state
 * is always identical regardless of when or where replay occurs.
 */
export function replayEvents(
  initialState: BoardStoreState,
  journal: readonly JournalEntry[],
  config: ReplayConfig,
): ReplayResult {
  const startTime = performance.now();

  let state: BoardStoreState = { ...initialState };
  let eventsProcessed = 0;
  let eventsSkipped = 0;
  const snapshots: ReplaySnapshot[] = [];
  const log: ReplayLogEntry[] = [];

  const fromSeq = BigInt(config.fromSequence ?? "0");
  const toSeq = config.toSequence ? BigInt(config.toSequence) : null;

  for (const entry of journal) {
    // ------------------------------------------------------------------
    // Abort check
    // ------------------------------------------------------------------
    if (config.abortSignal?.aborted) {
      return {
        success: false,
        state,
        eventsProcessed,
        eventsSkipped,
        durationMs: Math.round(performance.now() - startTime),
        finalSequence: state.boardSequence,
        snapshots,
        log,
        error: "Replay aborted by signal",
        aborted: true,
      };
    }

    const eventSeq = BigInt(entry.sequence);

    // ------------------------------------------------------------------
    // Range guard: skip events outside [fromSequence+1, toSequence]
    // ------------------------------------------------------------------
    if (eventSeq <= fromSeq) {
      eventsSkipped++;
      if (config.enableLog) {
        log.push(makeSkippedLog(entry, state, "BEFORE_RANGE"));
      }
      continue;
    }

    if (toSeq !== null && eventSeq > toSeq) {
      eventsSkipped++;
      if (config.enableLog) {
        log.push(makeSkippedLog(entry, state, "AFTER_RANGE"));
      }
      continue;
    }

    // ------------------------------------------------------------------
    // Idempotency: skip if sequence already applied
    // ------------------------------------------------------------------
    const currentSeq = BigInt(state.boardSequence);
    if (eventSeq <= currentSeq) {
      eventsSkipped++;
      if (config.enableLog) {
        log.push(makeSkippedLog(entry, state, "ALREADY_APPLIED"));
      }
      continue;
    }

    // ------------------------------------------------------------------
    // Schema migration (if configured)
    // ------------------------------------------------------------------
    let processedEntry = entry;
    if (config.migrateEvent) {
      try {
        processedEntry = config.migrateEvent(entry);
      } catch (err: any) {
        eventsSkipped++;
        if (config.enableLog) {
          log.push(makeSkippedLog(entry, state, `MIGRATION_FAILED: ${err?.message}`));
        }
        continue;
      }
    }

    // ------------------------------------------------------------------
    // Apply event via dispatcher (same path as live events)
    // ------------------------------------------------------------------
    const eventStartTime = performance.now();
    const boardSeqBefore = state.boardSequence;
    const entityId = extractEntityId(processedEntry.payload);
    const revisionBefore = getEntityRevision(state, entityId, processedEntry.type);

    const envelope: ClientEventEnvelope = {
      event: processedEntry.payload,
      acknowledged: true,
      replayed: true,
    };

    const context: ReducerContext = { mode: "replay" };

    try {
      const patch = dispatcherApplyEvent(state, envelope, context);
      state = {
        ...state,
        ...patch,
        boardSequence: processedEntry.sequence,
      };
    } catch (err: any) {
      // Reducer crash during replay — skip and log
      eventsSkipped++;
      if (config.enableLog) {
        log.push(makeSkippedLog(processedEntry, state, `REDUCER_CRASH: ${err?.message}`));
      }
      // Still advance sequence to maintain monotonicity
      state = { ...state, boardSequence: processedEntry.sequence };
      continue;
    }

    eventsProcessed++;

    const revisionAfter = getEntityRevision(state, entityId, processedEntry.type);

    if (config.enableLog) {
      log.push({
        sequence: processedEntry.sequence,
        eventType: processedEntry.type,
        eventId: processedEntry.eventId,
        appliedAt: Date.now(),
        durationMs: Math.round((performance.now() - eventStartTime) * 100) / 100,
        entityId,
        revisionBefore,
        revisionAfter,
        boardSequenceBefore: boardSeqBefore,
        boardSequenceAfter: state.boardSequence,
        skipped: false,
      });
    }

    // ------------------------------------------------------------------
    // Snapshot checkpoint
    // ------------------------------------------------------------------
    if (
      config.snapshotInterval > 0 &&
      eventsProcessed % config.snapshotInterval === 0
    ) {
      snapshots.push({
        sequence: state.boardSequence,
        capturedAt: Date.now(),
        state: deepFreeze(state),
        eventsApplied: eventsProcessed,
      });
    }
  }

  return {
    success: true,
    state,
    eventsProcessed,
    eventsSkipped,
    durationMs: Math.round(performance.now() - startTime),
    finalSequence: state.boardSequence,
    snapshots,
    log,
    aborted: false,
  };
}

// ============================================================================
// Replay from Empty State (convenience)
// ============================================================================

/**
 * Full board rebuild from scratch.
 * Use when projection is corrupt or gap is unrecoverable.
 */
export function rebuildBoardFromJournal(
  journal: readonly JournalEntry[],
  config: Omit<ReplayConfig, "fromSequence">,
): ReplayResult {
  return replayEvents(createEmptyBoardState(), journal, {
    ...config,
    fromSequence: "0",
  });
}

// ============================================================================
// Replay to Specific Sequence (for debugging)
// ============================================================================

/**
 * Rebuild state up to a specific sequence point.
 * Useful for debugging: "what did state look like at sequence 42?"
 */
export function replayToSequence(
  journal: readonly JournalEntry[],
  targetSequence: string,
  config?: Partial<ReplayConfig>,
): ReplayResult {
  return replayEvents(createEmptyBoardState(), journal, {
    boardId: config?.boardId ?? "",
    toSequence: targetSequence,
    snapshotInterval: config?.snapshotInterval ?? 0,
    enableLog: config?.enableLog ?? true,
    migrateEvent: config?.migrateEvent,
  });
}

// ============================================================================
// Diff Tool — Compare two states
// ============================================================================

export interface StateDiff {
  cardsAdded: string[];
  cardsRemoved: string[];
  cardsModified: string[];
  listsAdded: string[];
  listsRemoved: string[];
  listsModified: string[];
  listOrderChanged: boolean;
  sequenceDelta: { from: string; to: string };
}

export function diffStates(before: BoardStoreState, after: BoardStoreState): StateDiff {
  const beforeCardIds = new Set(Object.keys(before.cards));
  const afterCardIds = new Set(Object.keys(after.cards));

  const beforeListIds = new Set(Object.keys(before.lists));
  const afterListIds = new Set(Object.keys(after.lists));

  const cardsAdded = [...afterCardIds].filter((id) => !beforeCardIds.has(id));
  const cardsRemoved = [...beforeCardIds].filter((id) => !afterCardIds.has(id));
  const cardsModified = [...afterCardIds]
    .filter((id) => beforeCardIds.has(id))
    .filter((id) => {
      const b = before.cards[id];
      const a = after.cards[id];
      return b && a && (b.revision !== a.revision || b.listId !== a.listId || b.position !== a.position);
    });

  const listsAdded = [...afterListIds].filter((id) => !beforeListIds.has(id));
  const listsRemoved = [...beforeListIds].filter((id) => !afterListIds.has(id));
  const listsModified = [...afterListIds]
    .filter((id) => beforeListIds.has(id))
    .filter((id) => {
      const b = before.lists[id];
      const a = after.lists[id];
      return b && a && (b.revision !== a.revision || b.position !== a.position || b.title !== a.title);
    });

  const listOrderChanged =
    before.listOrder.length !== after.listOrder.length ||
    before.listOrder.some((id, i) => after.listOrder[i] !== id);

  return {
    cardsAdded,
    cardsRemoved,
    cardsModified,
    listsAdded,
    listsRemoved,
    listsModified,
    listOrderChanged,
    sequenceDelta: { from: before.boardSequence, to: after.boardSequence },
  };
}

// ============================================================================
// Helpers
// ============================================================================

function extractEntityId(event: AppDomainEvent): string {
  const p = event.payload as Record<string, unknown>;
  return (p.cardId ?? p.listId ?? event.aggregateId ?? "") as string;
}

function getEntityRevision(
  state: BoardStoreState,
  entityId: string,
  eventType: string,
): number | null {
  if (eventType.startsWith("card.")) {
    return state.cards[entityId]?.revision ?? null;
  }
  if (eventType.startsWith("list.")) {
    return state.lists[entityId]?.revision ?? null;
  }
  return null;
}

function makeSkippedLog(
  entry: JournalEntry,
  state: BoardStoreState,
  reason: string,
): ReplayLogEntry {
  return {
    sequence: entry.sequence,
    eventType: entry.type,
    eventId: entry.eventId,
    appliedAt: Date.now(),
    durationMs: 0,
    entityId: extractEntityId(entry.payload),
    revisionBefore: null,
    revisionAfter: null,
    boardSequenceBefore: state.boardSequence,
    boardSequenceAfter: state.boardSequence,
    skipped: true,
    skipReason: reason,
  };
}

function deepFreeze<T>(obj: T): Readonly<T> {
  // Shallow copy for snapshot isolation — not true deep freeze
  // (deep freeze is expensive; for debug snapshots, shallow copy suffices)
  if (typeof obj !== "object" || obj === null) return obj;
  return Object.freeze({ ...obj }) as Readonly<T>;
}
