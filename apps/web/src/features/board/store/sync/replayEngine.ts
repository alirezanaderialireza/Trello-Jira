// apps/web/src/features/board/store/sync/replayEngine.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// Deterministic event replay engine with:
//   • Stale-event guard (sequence-based dedup)
//   • Schema migration adapters (version-aware event transformation)
//   • Integrity validation via canonicalSerializer checksums
//   • Incremental replay from a verified snapshot
//   • Full replay from empty state
//   • Progress reporting for UI indicators
//
// ─── Relationship to projectionIntegrity.ts ──────────────────────────────────
// projectionIntegrity owns the checksum computation and rebuild orchestration.
// replayEngine owns the event-level pipeline:
//   sequencing → migration → dedup → apply → verify → report
//
// The rebuild functions in projectionIntegrity delegate to this engine's
// replayEvents() for the actual event application loop.
//
// ─── Design rules ────────────────────────────────────────────────────────────
//   • Pure — no Zustand calls, no side effects, no timers.
//   • Deterministic — same events in same order → same final state.
//   • Injectable — all dependencies (state, clock, schema adapters) injected.
//   • Replay-safe — idempotent by design (stale events silently skipped).
//   • Observable — returns detailed ReplayReport for telemetry.
// ─────────────────────────────────────────────────────────────────────────────

import type { AppDomainEvent } from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "../event-application/types";
import type { ReducerContext } from "../event-application/context";
import { applyEvent } from "../event-application/dispatcher";
import { createBoardState } from "../test-utils/createBoardState";
import { computeChecksumSync, type Checksum } from "@/lib/integrity/canonicalSerializer";

// ============================================================================
// 1.  Public Types
// ============================================================================

/** A single event in the replay stream — carries sequence for ordering/dedup. */
export interface SequencedEvent {
  readonly sequence: string; // BigInt-compatible string
  readonly event: AppDomainEvent;
}

/** Schema migration adapter — transforms events from older schema versions. */
export interface SchemaMigrationAdapter {
  /** The event type this adapter handles. */
  readonly eventType: string;
  /** The schema version this adapter migrates FROM. */
  readonly fromVersion: number;
  /** The schema version this adapter migrates TO. */
  readonly toVersion: number;
  /** Pure transformation function. Must not throw. */
  readonly migrate: (event: AppDomainEvent) => AppDomainEvent;
}

/** Progress callback for long replays. */
export type ReplayProgressFn = (progress: ReplayProgress) => void;

export interface ReplayProgress {
  readonly totalEvents: number;
  readonly processedEvents: number;
  readonly appliedEvents: number;
  readonly skippedEvents: number;
  readonly migratedEvents: number;
  readonly currentSequence: string;
  /** 0-1 float */
  readonly percentage: number;
}

/** Full report returned after replay completes. */
export interface ReplayReport {
  readonly finalState: BoardStoreState;
  readonly finalSequence: string;
  readonly finalChecksum: Checksum;

  readonly totalEvents: number;
  readonly appliedCount: number;
  readonly skippedCount: number;
  readonly migratedCount: number;
  readonly duplicateCount: number;

  /** Events that failed migration (non-fatal — skipped). */
  readonly migrationErrors: readonly MigrationError[];

  /** Elapsed wall-clock ms for the replay. */
  readonly durationMs: number;

  /** True if all events were applied without any skips or errors. */
  readonly clean: boolean;
}

export interface MigrationError {
  readonly eventId: string;
  readonly eventType: string;
  readonly fromVersion: number;
  readonly error: string;
}

/** Configuration for replayEvents(). */
export interface ReplayConfig {
  /**
   * Base state to replay on top of.
   * If omitted, starts from createBoardState() (empty).
   */
  baseState?: BoardStoreState;

  /**
   * The sequence the baseState was verified at.
   * Events with sequence <= this are skipped (dedup guard).
   * Defaults to baseState.boardSequence.
   */
  baseSequence?: string;

  /**
   * Ordered event stream to replay (ascending sequence).
   * MUST be pre-sorted by sequence — the engine does NOT re-sort.
   */
  events: readonly SequencedEvent[];

  /**
   * Schema migration adapters. Applied before each event is dispatched.
   * Multiple adapters can chain (fromVersion→toVersion→nextToVersion).
   */
  migrationAdapters?: readonly SchemaMigrationAdapter[];

  /**
   * Optional progress callback — called every PROGRESS_INTERVAL events.
   */
  onProgress?: ReplayProgressFn;

  /**
   * ReducerContext.mode to use for all applied events.
   * Default: "replay"
   */
  mode?: ReducerContext["mode"];
}

// ============================================================================
// 2.  Constants
// ============================================================================

/** How often to call onProgress during a long replay. */
const PROGRESS_INTERVAL = 100;

// ============================================================================
// 3.  Core replay function
// ============================================================================

/**
 * Deterministically replays an ordered event stream onto a base state.
 *
 * Guarantees:
 *   • Events with sequence ≤ baseSequence are silently skipped (dedup).
 *   • Events with sequence ≤ last-applied sequence are silently skipped
 *     (protects against out-of-order duplicates in the input).
 *   • Schema migration adapters are applied before dispatch.
 *   • Unknown event types are silently skipped (forward-compatibility).
 *   • Reducer stale-protection handles remaining idempotency.
 *   • Final state has boardSequence = max applied sequence.
 *   • Returns a djb2 checksum of the final projection.
 */
export function replayEvents(config: ReplayConfig): ReplayReport {
  const startTime = performance.now();

  // ── Initialize state ─────────────────────────────────────────────────────
  let state: BoardStoreState = config.baseState
    ? structuredClone(config.baseState)
    : createBoardState();

  const baseSeq = BigInt(config.baseSequence ?? state.boardSequence);
  let lastAppliedSeq = baseSeq;

  const mode: ReducerContext["mode"] = config.mode ?? "replay";
  const context: ReducerContext = { mode };

  // ── Migration adapter index ──────────────────────────────────────────────
  const adapterMap = buildAdapterMap(config.migrationAdapters ?? []);

  // ── Counters ─────────────────────────────────────────────────────────────
  let appliedCount   = 0;
  let skippedCount   = 0;
  let migratedCount  = 0;
  let duplicateCount = 0;
  const migrationErrors: MigrationError[] = [];

  const totalEvents = config.events.length;

  // ── Event loop ───────────────────────────────────────────────────────────
  for (let i = 0; i < totalEvents; i++) {
    const { sequence, event } = config.events[i]!;
    const eventSeq = BigInt(sequence);

    // ── Dedup guard: skip events at or below the base/last-applied sequence.
    if (eventSeq <= lastAppliedSeq) {
      duplicateCount++;
      continue;
    }

    // ── Schema migration ───────────────────────────────────────────────────
    let migratedEvent = event;
    const schemaVersion = event.schemaVersion ?? 1;
    const adapters = adapterMap.get(event.type);

    if (adapters && adapters.length > 0) {
      const migrateResult = runMigrationChain(adapters, migratedEvent, schemaVersion);
      if (migrateResult.error) {
        migrationErrors.push({
          eventId:     event.id,
          eventType:   event.type,
          fromVersion: schemaVersion,
          error:       migrateResult.error,
        });
        skippedCount++;
        continue; // Non-fatal: skip events that fail migration.
      }
      if (migrateResult.migrated) {
        migratedEvent = migrateResult.event;
        migratedCount++;
      }
    }

    // ── Build envelope ─────────────────────────────────────────────────────
    const envelope: ClientEventEnvelope = {
      event:        migratedEvent,
      optimistic:   false,
      acknowledged: true,
      replayed:     true,
    };

    // ── Apply via dispatcher ───────────────────────────────────────────────
    const partial = applyEvent(state, envelope, context);

    if (Object.keys(partial).length === 0) {
      skippedCount++;
    } else {
      state = { ...state, ...partial };
      appliedCount++;
    }

    // Advance sequence watermark.
    lastAppliedSeq = eventSeq;

    // ── Progress reporting ─────────────────────────────────────────────────
    if (config.onProgress && (i + 1) % PROGRESS_INTERVAL === 0) {
      config.onProgress({
        totalEvents,
        processedEvents: i + 1,
        appliedEvents:   appliedCount,
        skippedEvents:   skippedCount,
        migratedEvents:  migratedCount,
        currentSequence: sequence,
        percentage:      (i + 1) / totalEvents,
      });
    }
  }

  // ── Finalize ─────────────────────────────────────────────────────────────
  state = { ...state, boardSequence: String(lastAppliedSeq) };

  const finalChecksum = computeChecksumSync(state);
  const durationMs    = performance.now() - startTime;

  // Final progress report.
  if (config.onProgress && totalEvents > 0) {
    config.onProgress({
      totalEvents,
      processedEvents: totalEvents,
      appliedEvents:   appliedCount,
      skippedEvents:   skippedCount,
      migratedEvents:  migratedCount,
      currentSequence: String(lastAppliedSeq),
      percentage:      1,
    });
  }

  return {
    finalState:     state,
    finalSequence:  String(lastAppliedSeq),
    finalChecksum,
    totalEvents,
    appliedCount,
    skippedCount,
    migratedCount,
    duplicateCount,
    migrationErrors,
    durationMs,
    clean: skippedCount === 0 && migrationErrors.length === 0 && duplicateCount === 0,
  };
}

// ============================================================================
// 4.  Determinism validation — replay twice and compare checksums
// ============================================================================

export interface DeterminismResult {
  readonly deterministic: boolean;
  readonly checksum1: Checksum;
  readonly checksum2: Checksum;
  readonly report1: ReplayReport;
  readonly report2: ReplayReport;
}

/**
 * Replays the same event stream twice from scratch and compares the final
 * checksums. If they differ, the system has a non-determinism bug.
 *
 * Use in CI/testing to catch reducer impurity.
 */
export function validateReplayDeterminism(
  events: readonly SequencedEvent[],
  adapters?: readonly SchemaMigrationAdapter[],
): DeterminismResult {
  const report1 = replayEvents({ events, migrationAdapters: adapters });
  const report2 = replayEvents({ events, migrationAdapters: adapters });

  return {
    deterministic: report1.finalChecksum.hash === report2.finalChecksum.hash,
    checksum1:     report1.finalChecksum,
    checksum2:     report2.finalChecksum,
    report1,
    report2,
  };
}

// ============================================================================
// 5.  Incremental replay — from a verified snapshot + delta
// ============================================================================

export interface IncrementalReplayConfig {
  /** Verified snapshot state. */
  snapshot: BoardStoreState;
  /** Sequence the snapshot was taken at. */
  snapshotSequence: string;
  /** Delta events with sequence > snapshotSequence, ordered ascending. */
  deltaEvents: readonly SequencedEvent[];
  /** Optional migration adapters. */
  migrationAdapters?: readonly SchemaMigrationAdapter[];
  /** Optional progress callback. */
  onProgress?: ReplayProgressFn;
}

/**
 * Replays only the delta on top of a known-good snapshot.
 * Much cheaper than full replay for reconnect/catch-up scenarios.
 */
export function incrementalReplay(config: IncrementalReplayConfig): ReplayReport {
  return replayEvents({
    baseState:         config.snapshot,
    baseSequence:      config.snapshotSequence,
    events:            config.deltaEvents,
    migrationAdapters: config.migrationAdapters,
    onProgress:        config.onProgress,
    mode:              "replay",
  });
}

// ============================================================================
// 6.  Snapshot verification — verifyStampedSnapshot
// ============================================================================

export interface StampedSnapshot {
  readonly state: BoardStoreState;
  readonly sequence: string;
  readonly checksum: Checksum;
  readonly stampedAt: string; // ISO-8601
}

/**
 * Creates a stamped snapshot from the current state.
 * The checksum covers the full projection (same input as projectionIntegrity).
 */
export function createStampedSnapshot(state: BoardStoreState): StampedSnapshot {
  return {
    state:     structuredClone(state),
    sequence:  state.boardSequence,
    checksum:  computeChecksumSync(state),
    stampedAt: new Date().toISOString(),
  };
}

/**
 * Verifies a stamped snapshot by recomputing its checksum.
 * If the hash doesn't match, the snapshot was corrupted.
 */
export function verifyStampedSnapshot(
  snapshot: StampedSnapshot,
): { valid: boolean; currentChecksum: Checksum } {
  const current = computeChecksumSync(snapshot.state);
  return {
    valid:           current.hash === snapshot.checksum.hash,
    currentChecksum: current,
  };
}

// ============================================================================
// 7.  Internal — migration chain runner
// ============================================================================

interface MigrationResult {
  event: AppDomainEvent;
  migrated: boolean;
  error?: string;
}

/**
 * Runs the migration chain for a single event.
 * Chains adapters: v1→v2→v3 if multiple adapters exist.
 */
function runMigrationChain(
  adapters: readonly SchemaMigrationAdapter[],
  event: AppDomainEvent,
  currentVersion: number,
): MigrationResult {
  let result = event;
  let migrated = false;

  // Sort adapters by fromVersion ascending to chain correctly.
  const sorted = [...adapters].sort((a, b) => a.fromVersion - b.fromVersion);

  for (const adapter of sorted) {
    if (adapter.fromVersion < currentVersion) continue; // already past this version
    if (adapter.fromVersion > currentVersion) break; // no adapter for current version

    try {
      result = adapter.migrate(result);
      currentVersion = adapter.toVersion;
      migrated = true;
    } catch (err: any) {
      return { event: result, migrated, error: err.message ?? "Unknown migration error" };
    }
  }

  return { event: result, migrated };
}

/**
 * Builds a lookup map: eventType → sorted adapters for that type.
 */
function buildAdapterMap(
  adapters: readonly SchemaMigrationAdapter[],
): Map<string, SchemaMigrationAdapter[]> {
  const map = new Map<string, SchemaMigrationAdapter[]>();

  for (const adapter of adapters) {
    const existing = map.get(adapter.eventType) ?? [];
    existing.push(adapter);
    map.set(adapter.eventType, existing);
  }

  // Sort each list by fromVersion for chaining.
  for (const [, list] of map) {
    list.sort((a, b) => a.fromVersion - b.fromVersion);
  }

  return map;
}
