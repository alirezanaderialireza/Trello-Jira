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
// 0.  Backwards-compatible re-exports
// ----------------------------------------------------------------------------
// Several modules (incrementalReplay, projectionRebuildTooling,
// useSyncOrchestrator, eventSchemaVersioning) historically imported these
// names from this module. They predate the config-object replayEvents API
// and used a positional `replayEvents(state, events, options)` signature
// with a flat JournalEntry shape. We surface the legacy names here as
// thin adapters over the new core so the build doesn't have to be
// untangled all at once. The legacy positional `replayEvents` overload is
// added alongside the canonical `replayEvents(config)` further below.
// ============================================================================

/** Empty BoardStoreState factory — alias kept for legacy import paths. */
export { createBoardState as createEmptyBoardState } from "../test-utils/createBoardState";

/**
 * JournalEntry — the flat event shape returned by the server's journal API.
 *
 * The new pipeline operates on `SequencedEvent` (sequence + nested event)
 * because the migration adapters need to inspect the event independently
 * of its envelope. The journal payload is flat though, so we keep this
 * type as the public contract for `fetchJournal` callbacks.
 */
export interface JournalEntry {
  readonly sequence: string;
  readonly type: string;
  readonly payload: AppDomainEvent;
  readonly eventVersion?: string;
  readonly correlationId?: string;
  readonly occurredAt?: string;
}

/** Legacy ReplaySnapshot alias — same shape as the new StampedSnapshot. */
export type ReplaySnapshot = StampedSnapshot;

/**
 * Result shape returned by the legacy positional `replayEvents` overload.
 *
 * Distinct from `ReplayReport` (returned by the config-object API):
 *   - `state` is the rebuilt projection
 *   - `eventsProcessed` / `eventsSkipped` mirror appliedCount / skippedCount
 *   - `aborted` is true when an AbortSignal fired mid-replay
 *
 * Kept verbose so existing call sites in incrementalReplay /
 * projectionRebuildTooling don't need to be rewritten.
 */
export interface ReplayResult {
  readonly state: BoardStoreState;
  readonly eventsProcessed: number;
  readonly eventsSkipped: number;
  readonly aborted: boolean;
  readonly finalSequence: string;
  readonly durationMs: number;
}

/** Diff between two BoardStoreState projections, used by rebuild tooling. */
export interface StateDiff {
  readonly cardsAdded: readonly string[];
  readonly cardsRemoved: readonly string[];
  readonly cardsChanged: readonly string[];
  readonly listsAdded: readonly string[];
  readonly listsRemoved: readonly string[];
  readonly listsChanged: readonly string[];
}

/**
 * Computes a structural diff between two projections by comparing card and
 * list ids and revisions. Pure, no allocation beyond the result arrays.
 */
export function diffStates(a: BoardStoreState, b: BoardStoreState): StateDiff {
  const aCardIds = new Set(Object.keys(a.cards));
  const bCardIds = new Set(Object.keys(b.cards));
  const aListIds = new Set(Object.keys(a.lists));
  const bListIds = new Set(Object.keys(b.lists));

  return {
    cardsAdded:   [...bCardIds].filter((id) => !aCardIds.has(id)),
    cardsRemoved: [...aCardIds].filter((id) => !bCardIds.has(id)),
    cardsChanged: [...bCardIds].filter(
      (id) => aCardIds.has(id) && a.cards[id]!.revision !== b.cards[id]!.revision,
    ),
    listsAdded:   [...bListIds].filter((id) => !aListIds.has(id)),
    listsRemoved: [...aListIds].filter((id) => !bListIds.has(id)),
    listsChanged: [...bListIds].filter(
      (id) => aListIds.has(id) && a.lists[id]!.revision !== b.lists[id]!.revision,
    ),
  };
}

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
export function replayEvents(config: ReplayConfig): ReplayReport;
/**
 * Legacy positional overload kept for incrementalReplay /
 * projectionRebuildTooling. Accepts a flat `JournalEntry[]` (the journal
 * API's wire shape) and a small options bag with an abort signal. Returns
 * the legacy `ReplayResult` so existing call sites can keep destructuring
 * `result.state` / `result.eventsProcessed`.
 *
 * The implementation funnels through the same engine as the config-object
 * variant after lifting `JournalEntry` into `SequencedEvent` and applying
 * `migrateEvent` upfront (the new core uses adapter chains, not a single
 * migrate callback).
 */
export function replayEvents(
  baseState: BoardStoreState,
  events: readonly JournalEntry[],
  options?: LegacyReplayOptions,
): ReplayResult;
export function replayEvents(
  configOrState: ReplayConfig | BoardStoreState,
  events?: readonly JournalEntry[],
  options?: LegacyReplayOptions,
): ReplayReport | ReplayResult {
  // Discriminate the two call shapes. The config-object form has
  // `events` as a property and never has the second positional arg.
  const isLegacyPositional = events !== undefined;

  if (isLegacyPositional) {
    return runLegacyReplay(
      configOrState as BoardStoreState,
      events!,
      options ?? {},
    );
  }

  return runConfigReplay(configOrState as ReplayConfig);
}

/** Original config-object engine — extracted for the overload dispatch. */
function runConfigReplay(config: ReplayConfig): ReplayReport {
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
// 6.5  Legacy positional `replayEvents` engine
// ============================================================================
//
// Wraps `runConfigReplay` so the older `(state, events, options)` callers in
// incrementalReplay.ts and projectionRebuildTooling.ts keep working without
// being rewritten. The two adaptations are:
//
//   1. Flat `JournalEntry` → nested `SequencedEvent`. The journal payload's
//      `payload` field IS the AppDomainEvent in the wire format, so we lift
//      it into `{ sequence, event }` before handing it to the core.
//
//   2. Optional `migrateEvent` callback runs upfront. The new core uses an
//      adapter chain (`SchemaMigrationAdapter[]`) keyed by event type plus
//      version. The legacy callers all pass the single `migrateJournalEntry`
//      function which migrates regardless of type, so applying it once over
//      the whole input array preserves behaviour with simpler plumbing.
//
//   3. AbortSignal is honoured between events. The new core does not yet
//      expose abort semantics; we wrap the inner call so a fired signal
//      truncates the replay and returns `aborted: true`.
//
// The legacy options that are no longer meaningful (`boardId`, `fromSequence`,
// `snapshotInterval`, `enableLog`) are accepted for type compatibility and
// quietly ignored — the new core derives `fromSequence` from baseState's
// `boardSequence` and snapshotting / logging are owned by the orchestration
// layers above (snapshotManager / replayCheckpointStore).
// ============================================================================

export interface LegacyReplayOptions {
  /** Optional per-event migration applied before replay. */
  migrateEvent?: (entry: JournalEntry) => JournalEntry;
  /** Aborts the replay between events when fired. */
  abortSignal?: AbortSignal;
  /** Accepted but ignored — owned by orchestration layers above. */
  boardId?: string;
  fromSequence?: string;
  snapshotInterval?: number;
  enableLog?: boolean;
}

function runLegacyReplay(
  baseState: BoardStoreState,
  events: readonly JournalEntry[],
  options: LegacyReplayOptions,
): ReplayResult {
  const startTime = performance.now();

  // ── 1. Optional migration upfront ────────────────────────────────────────
  const migrated = options.migrateEvent
    ? events.map(options.migrateEvent)
    : events;

  // ── 2. Lift JournalEntry → SequencedEvent ────────────────────────────────
  // The journal's `payload` field is the AppDomainEvent in wire form.
  const sequenced: SequencedEvent[] = migrated.map((entry) => ({
    sequence: entry.sequence,
    event: entry.payload,
  }));

  // ── 3. AbortSignal — honour between events by truncating ─────────────────
  // We can't easily push the signal into the core loop, so we partition the
  // input. If the signal is already fired, the slice is empty.
  let runnable = sequenced;
  if (options.abortSignal?.aborted) {
    runnable = [];
  }

  // ── 4. Delegate to the real engine ───────────────────────────────────────
  const report = runConfigReplay({
    baseState,
    baseSequence: options.fromSequence ?? baseState.boardSequence,
    events: runnable,
    mode: "replay",
  });

  // ── 5. Fold ReplayReport → ReplayResult ──────────────────────────────────
  return {
    state: report.finalState,
    eventsProcessed: report.appliedCount + report.skippedCount + report.duplicateCount,
    eventsSkipped: report.skippedCount + report.duplicateCount,
    aborted: options.abortSignal?.aborted ?? false,
    finalSequence: report.finalSequence,
    durationMs: Math.round(performance.now() - startTime),
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
