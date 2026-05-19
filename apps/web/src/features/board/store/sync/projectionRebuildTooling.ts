// apps/web/src/features/board/store/sync/projectionRebuildTooling.ts
// -----------------------------------------------------------------------------
// Projection Rebuild Tooling.
//
// Provides the full lifecycle for wiping and rebuilding client-side projections
// from the server event journal. Used when:
//   - SyncFSM enters "resyncing" state (gap_unrecoverable)
//   - Manual developer-triggered rebuild via devtools
//   - Projection corruption detected (hash mismatch, revision inconsistency)
//   - Board reload after long offline period
//
// Components:
//   1. ProjectionWiper — atomically resets store to empty state
//   2. ProjectionRebuilder — fetches journal from server + replays
//   3. SnapshotAnalyzer — validates projection integrity post-rebuild
//   4. RebuildOrchestrator — coordinates wipe → fetch → replay → validate
//   5. Debug tooling — export/import snapshots, compare live vs replayed
//
// Design:
//   - Orchestrator is the single entry point for any rebuild operation
//   - All operations are observable (progress callbacks)
//   - Abortable via AbortController
//   - No direct store mutations — returns new state, caller applies
//   - Integrates with ReplayEngine for deterministic rebuild
//   - Integrates with EventSchemaVersioning for payload migration
// -----------------------------------------------------------------------------

import type { BoardStoreState } from "../useBoardStore";
import type { JournalEntry, ReplayResult, ReplaySnapshot } from "./replayEngine";
import {
  createEmptyBoardState,
  replayEvents,
  diffStates,
  type StateDiff,
} from "./replayEngine";
import { migrateJournalEntry } from "./eventSchemaVersioning";

// ============================================================================
// Types
// ============================================================================

/** Progress callback for long-running rebuild operations */
export type RebuildProgressCallback = (progress: RebuildProgress) => void;

export interface RebuildProgress {
  phase: "wipe" | "fetch" | "replay" | "validate" | "complete" | "error";
  /** 0–100 percentage (approximate) */
  percent: number;
  /** Human-readable status */
  message: string;
  /** Additional context */
  detail?: Record<string, unknown>;
}

/** Configuration for a rebuild operation */
export interface RebuildConfig {
  boardId: string;
  tenantId: string;
  /** Function to fetch event journal from server (injected — no direct API dep) */
  fetchJournal: (params: {
    boardId: string;
    fromSequence: string;
    limit: number;
    abortSignal?: AbortSignal;
  }) => Promise<{ events: JournalEntry[]; hasMore: boolean; latestSequence: string }>;
  /** Batch size for fetching journal pages */
  fetchBatchSize?: number;
  /** Capture intermediate snapshots every N events (0 = disabled) */
  snapshotInterval?: number;
  /** Enable detailed replay log */
  enableLog?: boolean;
  /** Progress callback */
  onProgress?: RebuildProgressCallback;
  /** Abort signal */
  abortSignal?: AbortSignal;
}

/** Result of a full rebuild operation */
export interface RebuildResult {
  success: boolean;
  /** Rebuilt state (null if failed/aborted) */
  state: BoardStoreState | null;
  /** Diff between old live state and rebuilt state */
  diff: StateDiff | null;
  /** Replay result details */
  replayResult: ReplayResult | null;
  /** Integrity validation result */
  validation: ProjectionValidation | null;
  /** Total duration in ms */
  durationMs: number;
  /** Error message if failed */
  error?: string;
  /** Was the operation aborted */
  aborted: boolean;
}

// ============================================================================
// 1. Projection Wiper
// ============================================================================

/**
 * Creates a clean empty state for the board.
 * Does NOT mutate anything — returns a fresh state object.
 */
export function wipeProjection(): BoardStoreState {
  return createEmptyBoardState();
}

// ============================================================================
// 2. Projection Rebuilder (fetches journal + replays)
// ============================================================================

/**
 * Fetches the full event journal from server in paginated batches,
 * then replays all events to produce a rebuilt state.
 */
export async function fetchAndReplayJournal(
  config: RebuildConfig,
): Promise<{ state: BoardStoreState; replayResult: ReplayResult; totalFetched: number }> {
  const allEvents: JournalEntry[] = [];
  let fromSequence = "0";
  let hasMore = true;
  const batchSize = config.fetchBatchSize ?? 200;
  let batchCount = 0;

  // Fetch all journal pages
  while (hasMore) {
    if (config.abortSignal?.aborted) {
      throw new RebuildAbortedError("Aborted during journal fetch");
    }

    const page = await config.fetchJournal({
      boardId: config.boardId,
      fromSequence,
      limit: batchSize,
      abortSignal: config.abortSignal,
    });

    allEvents.push(...page.events);
    hasMore = page.hasMore;
    fromSequence = page.latestSequence;
    batchCount++;

    config.onProgress?.({
      phase: "fetch",
      percent: Math.min(90, batchCount * 10), // Approximate — we don't know total
      message: `Fetched ${allEvents.length} events (batch ${batchCount})`,
      detail: { totalEvents: allEvents.length, hasMore },
    });
  }

  config.onProgress?.({
    phase: "fetch",
    percent: 100,
    message: `Journal fetch complete: ${allEvents.length} events`,
  });

  // Replay all events
  config.onProgress?.({
    phase: "replay",
    percent: 0,
    message: "Starting deterministic replay...",
  });

  const emptyState = createEmptyBoardState();
  const replayResult = replayEvents(emptyState, allEvents, {
    boardId: config.boardId,
    fromSequence: "0",
    snapshotInterval: config.snapshotInterval ?? 0,
    enableLog: config.enableLog ?? false,
    migrateEvent: migrateJournalEntry,
    abortSignal: config.abortSignal,
  });

  config.onProgress?.({
    phase: "replay",
    percent: 100,
    message: `Replay complete: ${replayResult.eventsProcessed} applied, ${replayResult.eventsSkipped} skipped`,
  });

  return { state: replayResult.state, replayResult, totalFetched: allEvents.length };
}

// ============================================================================
// 3. Snapshot Analyzer (Projection Integrity Validation)
// ============================================================================

export interface ProjectionValidation {
  valid: boolean;
  checks: ValidationCheck[];
  /** Overall health score 0–100 */
  healthScore: number;
}

export interface ValidationCheck {
  name: string;
  passed: boolean;
  message: string;
  severity: "error" | "warning" | "info";
}

/**
 * Validates the integrity of a rebuilt projection.
 * Checks:
 *   1. cardsByList consistency: every card in cards{} is referenced in cardsByList{}
 *   2. listOrder consistency: every list in lists{} is in listOrder[]
 *   3. No orphan cardsByList entries (list doesn't exist)
 *   4. No duplicate card references across lists
 *   5. Sequence monotonicity: boardSequence > "0"
 *   6. Revision sanity: no negative revisions
 */
export function validateProjection(state: BoardStoreState): ProjectionValidation {
  const checks: ValidationCheck[] = [];

  // Check 1: cardsByList references valid cards
  const allReferencedCards = new Set<string>();
  for (const [listId, cardIds] of Object.entries(state.cardsByList)) {
    for (const cardId of cardIds) {
      if (!state.cards[cardId]) {
        checks.push({
          name: "cardsByList_orphan_card",
          passed: false,
          message: `cardsByList["${listId}"] references non-existent card "${cardId}"`,
          severity: "error",
        });
      }
      if (allReferencedCards.has(cardId)) {
        checks.push({
          name: "cardsByList_duplicate_card",
          passed: false,
          message: `Card "${cardId}" referenced in multiple lists`,
          severity: "error",
        });
      }
      allReferencedCards.add(cardId);
    }
  }

  // Check 2: every card has a cardsByList entry
  for (const [cardId, card] of Object.entries(state.cards)) {
    const listCards = state.cardsByList[card.listId];
    if (!listCards || !listCards.includes(cardId)) {
      checks.push({
        name: "card_missing_from_cardsByList",
        passed: false,
        message: `Card "${cardId}" in list "${card.listId}" not found in cardsByList`,
        severity: "error",
      });
    }
  }

  // Check 3: listOrder references valid lists
  for (const listId of state.listOrder) {
    if (!state.lists[listId]) {
      checks.push({
        name: "listOrder_orphan_list",
        passed: false,
        message: `listOrder references non-existent list "${listId}"`,
        severity: "error",
      });
    }
  }

  // Check 4: every list is in listOrder
  for (const listId of Object.keys(state.lists)) {
    if (!state.listOrder.includes(listId)) {
      checks.push({
        name: "list_missing_from_listOrder",
        passed: false,
        message: `List "${listId}" exists but not in listOrder`,
        severity: "warning",
      });
    }
  }

  // Check 5: no orphan cardsByList entries
  for (const listId of Object.keys(state.cardsByList)) {
    if (!state.lists[listId]) {
      checks.push({
        name: "cardsByList_orphan_list",
        passed: false,
        message: `cardsByList has entry for non-existent list "${listId}"`,
        severity: "warning",
      });
    }
  }

  // Check 6: boardSequence sanity
  if (BigInt(state.boardSequence) < 0n) {
    checks.push({
      name: "negative_sequence",
      passed: false,
      message: `boardSequence is negative: ${state.boardSequence}`,
      severity: "error",
    });
  }

  // Check 7: revision sanity
  for (const [cardId, card] of Object.entries(state.cards)) {
    if (card.revision < 0) {
      checks.push({
        name: "negative_card_revision",
        passed: false,
        message: `Card "${cardId}" has negative revision: ${card.revision}`,
        severity: "error",
      });
    }
  }
  for (const [listId, list] of Object.entries(state.lists)) {
    if (list.revision < 0) {
      checks.push({
        name: "negative_list_revision",
        passed: false,
        message: `List "${listId}" has negative revision: ${list.revision}`,
        severity: "error",
      });
    }
  }

  // If no checks failed, add a pass marker
  if (checks.length === 0) {
    checks.push({
      name: "all_passed",
      passed: true,
      message: "All projection integrity checks passed",
      severity: "info",
    });
  }

  const errorCount = checks.filter((c) => !c.passed && c.severity === "error").length;
  const warningCount = checks.filter((c) => !c.passed && c.severity === "warning").length;
  const healthScore = Math.max(0, 100 - errorCount * 20 - warningCount * 5);

  return {
    valid: errorCount === 0,
    checks,
    healthScore,
  };
}

// ============================================================================
// 4. Rebuild Orchestrator
// ============================================================================

/**
 * Full rebuild orchestrator: wipe → fetch → replay → validate.
 *
 * Does NOT mutate the store directly — returns the rebuilt state.
 * The caller (typically the SyncFSM effect handler) is responsible for
 * applying the state to useBoardStore via setState.
 */
export async function rebuildProjection(
  liveState: BoardStoreState,
  config: RebuildConfig,
): Promise<RebuildResult> {
  const startTime = performance.now();

  try {
    // Phase 1: Wipe
    config.onProgress?.({
      phase: "wipe",
      percent: 100,
      message: "Projection wiped (in-memory only — not applied yet)",
    });

    // Phase 2: Fetch + Replay
    const { state, replayResult, totalFetched } = await fetchAndReplayJournal(config);

    if (replayResult.aborted) {
      return {
        success: false,
        state: null,
        diff: null,
        replayResult,
        validation: null,
        durationMs: Math.round(performance.now() - startTime),
        error: "Replay was aborted",
        aborted: true,
      };
    }

    // Phase 3: Validate
    config.onProgress?.({
      phase: "validate",
      percent: 0,
      message: "Validating projection integrity...",
    });

    const validation = validateProjection(state);

    config.onProgress?.({
      phase: "validate",
      percent: 100,
      message: `Validation complete: health=${validation.healthScore}%`,
      detail: { healthScore: validation.healthScore, valid: validation.valid },
    });

    // Phase 4: Diff against live state
    const diff = diffStates(liveState, state);

    // Complete
    config.onProgress?.({
      phase: "complete",
      percent: 100,
      message: `Rebuild complete: ${replayResult.eventsProcessed} events, health=${validation.healthScore}%`,
      detail: {
        eventsProcessed: replayResult.eventsProcessed,
        eventsSkipped: replayResult.eventsSkipped,
        cardsAdded: diff.cardsAdded.length,
        cardsRemoved: diff.cardsRemoved.length,
        listsAdded: diff.listsAdded.length,
        listsRemoved: diff.listsRemoved.length,
      },
    });

    return {
      success: validation.valid,
      state,
      diff,
      replayResult,
      validation,
      durationMs: Math.round(performance.now() - startTime),
      aborted: false,
    };
  } catch (err: any) {
    if (err instanceof RebuildAbortedError) {
      config.onProgress?.({
        phase: "error",
        percent: 0,
        message: "Rebuild aborted",
      });
      return {
        success: false,
        state: null,
        diff: null,
        replayResult: null,
        validation: null,
        durationMs: Math.round(performance.now() - startTime),
        error: err.message,
        aborted: true,
      };
    }

    config.onProgress?.({
      phase: "error",
      percent: 0,
      message: `Rebuild failed: ${err?.message ?? "Unknown error"}`,
    });

    return {
      success: false,
      state: null,
      diff: null,
      replayResult: null,
      validation: null,
      durationMs: Math.round(performance.now() - startTime),
      error: err?.message ?? "Unknown error",
      aborted: false,
    };
  }
}

// ============================================================================
// 5. Debug Tooling
// ============================================================================

/** Export current store state as a serializable snapshot (for debugging) */
export function exportSnapshot(state: BoardStoreState): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      boardSequence: state.boardSequence,
      listsCount: Object.keys(state.lists).length,
      cardsCount: Object.keys(state.cards).length,
      state,
    },
    null,
    2,
  );
}

/** Import a previously exported snapshot */
export function importSnapshot(json: string): BoardStoreState | null {
  try {
    const parsed = JSON.parse(json);
    if (parsed?.state && typeof parsed.state.boardSequence === "string") {
      return parsed.state as BoardStoreState;
    }
    return null;
  } catch {
    return null;
  }
}

/** Compare live state vs a snapshot (for devtools) */
export function analyzeSnapshot(
  liveState: BoardStoreState,
  snapshot: BoardStoreState,
): {
  diff: StateDiff;
  liveValidation: ProjectionValidation;
  snapshotValidation: ProjectionValidation;
  sequenceGap: bigint;
} {
  return {
    diff: diffStates(snapshot, liveState),
    liveValidation: validateProjection(liveState),
    snapshotValidation: validateProjection(snapshot),
    sequenceGap: BigInt(liveState.boardSequence) - BigInt(snapshot.boardSequence),
  };
}

// ============================================================================
// Errors
// ============================================================================

export class RebuildAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RebuildAbortedError";
  }
}
