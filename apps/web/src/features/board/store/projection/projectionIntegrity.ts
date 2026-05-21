// apps/web/src/features/board/store/projection/projectionIntegrity.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// Provides deterministic hash-based integrity checking and incremental rebuild
// tooling for the board projection.
//
// ─── Architecture ────────────────────────────────────────────────────────────
// Three independent capabilities:
//
//  1. computeProjectionChecksum(state)
//     Produces a canonical JSON fingerprint of every projection slice.
//     Deterministic: same state → same hash regardless of insertion order.
//     Used after snapshot hydration, reconnect, and background validation.
//
//  2. validateProjectionIntegrity(state, expectedChecksum)
//     Compares the live state against a known-good checksum.
//     Returns a typed result — never throws.
//
//  3. ProjectionRebuildEngine
//     Accepts a stream of domain events and a blank state, replays them
//     deterministically via the dispatcher, and returns the fully rebuilt
//     projection.  Supports incremental replay (from a snapshot + delta).
//
// ─── Contracts guaranteed ────────────────────────────────────────────────────
//   • Pure — no Zustand dependency, no side-effects.
//   • Deterministic — same events in same order → same checksum.
//   • Replay-safe — applying the same event twice produces the same state
//     (guarded by individual reducer stale-protection).
//   • No external crypto library — uses SubtleCrypto (Web standard) for SHA-256.
//     Falls back to a djb2-based string hash in environments without SubtleCrypto
//     (test runners, Node < 20).
// ─────────────────────────────────────────────────────────────────────────────

import type { AppDomainEvent } from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "../event-application/types";
import { applyEvent } from "../event-application/dispatcher";
import { createBoardState } from "../test-utils/createBoardState";

// ============================================================================
// 1.  Canonical JSON serialisation
//     Produces a stable string regardless of object key insertion order.
// ============================================================================

/**
 * Recursively serialises a value to canonical JSON (sorted object keys).
 * Arrays preserve their order — only object keys are sorted.
 */
function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJSON).join(",") + "]";
  }

  // Sort keys for determinism.
  const sorted = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => {
      const v = (value as Record<string, unknown>)[k];
      return `${JSON.stringify(k)}:${canonicalJSON(v)}`;
    })
    .join(",");

  return "{" + sorted + "}";
}

// ============================================================================
// 2.  Hash implementation
//     SHA-256 (async) when SubtleCrypto is available; djb2 (sync) otherwise.
// ============================================================================

/** Synchronous djb2 hash — fallback for environments without SubtleCrypto. */
function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Async SHA-256 via SubtleCrypto. Returns hex string. */
async function sha256(str: string): Promise<string> {
  const data = new TextEncoder().encode(str);
  const buf  = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ============================================================================
// 3.  ProjectionChecksum
// ============================================================================

export interface ProjectionChecksum {
  /** SHA-256 hex string (or djb2 hex in non-crypto envs). */
  readonly hash: string;
  /** ISO-8601 UTC timestamp of when this checksum was computed. */
  readonly computedAt: string;
  /** The boardSequence the projection was at when this was computed. */
  readonly sequence: string;
  /** Which algorithm produced the hash — for audit. */
  readonly algorithm: "sha256" | "djb2";
}

/**
 * The subset of BoardStoreState that forms the checksum input.
 * Excludes ephemeral slices (bufferedEvents, pendingMutations, syncStatus)
 * that change independently of domain state.
 */
export interface ProjectionChecksumInput {
  lists:             BoardStoreState["lists"];
  cards:             BoardStoreState["cards"];
  cardsByList:       BoardStoreState["cardsByList"];
  listOrder:         BoardStoreState["listOrder"];
  labels:            BoardStoreState["labels"];
  labelsByBoard:     BoardStoreState["labelsByBoard"];
  checklists:        BoardStoreState["checklists"];
  checklistsByCard:  BoardStoreState["checklistsByCard"];
  comments:          BoardStoreState["comments"];
  commentsByCard:    BoardStoreState["commentsByCard"];
  attachments:       BoardStoreState["attachments"];
  attachmentsByCard: BoardStoreState["attachmentsByCard"];
  templates:         BoardStoreState["templates"];
  templatesByBoard:  BoardStoreState["templatesByBoard"];
}

function extractChecksumInput(state: BoardStoreState): ProjectionChecksumInput {
  return {
    lists:             state.lists,
    cards:             state.cards,
    cardsByList:       state.cardsByList,
    listOrder:         state.listOrder,
    labels:            state.labels,
    labelsByBoard:     state.labelsByBoard,
    checklists:        state.checklists,
    checklistsByCard:  state.checklistsByCard,
    comments:          state.comments,
    commentsByCard:    state.commentsByCard,
    attachments:       state.attachments,
    attachmentsByCard: state.attachmentsByCard,
    templates:         state.templates,
    templatesByBoard:  state.templatesByBoard,
  };
}

/**
 * Asynchronously computes a SHA-256 checksum of the entire projection.
 * Falls back to djb2 if SubtleCrypto is unavailable.
 */
export async function computeProjectionChecksum(
  state: BoardStoreState,
): Promise<ProjectionChecksum> {
  const input    = extractChecksumInput(state);
  const canonical = canonicalJSON(input);

  let hash:      string;
  let algorithm: ProjectionChecksum["algorithm"];

  if (
    typeof crypto !== "undefined" &&
    typeof crypto.subtle !== "undefined" &&
    typeof crypto.subtle.digest === "function"
  ) {
    hash      = await sha256(canonical);
    algorithm = "sha256";
  } else {
    hash      = djb2Hash(canonical);
    algorithm = "djb2";
  }

  return {
    hash,
    computedAt: new Date().toISOString(),
    sequence:   state.boardSequence,
    algorithm,
  };
}

/**
 * Synchronous variant using djb2.
 * Use when you cannot await (e.g. inside a Zustand set() callback).
 */
export function computeProjectionChecksumSync(
  state: BoardStoreState,
): ProjectionChecksum {
  const input    = extractChecksumInput(state);
  const canonical = canonicalJSON(input);

  return {
    hash:       djb2Hash(canonical),
    computedAt: new Date().toISOString(),
    sequence:   state.boardSequence,
    algorithm:  "djb2",
  };
}

// ============================================================================
// 4.  Integrity Validation
// ============================================================================

export type IntegrityCheckResult =
  | { valid: true;  checksum: ProjectionChecksum }
  | {
      valid:            false;
      checksum:         ProjectionChecksum;
      expectedHash:     string;
      sequence:         string;
      reason:           "HASH_MISMATCH" | "SEQUENCE_MISMATCH";
    };

/**
 * Validates the live projection against a previously recorded checksum.
 *
 * @param state           Current BoardStoreState.
 * @param expected        Checksum recorded after a known-good snapshot.
 * @param enforceSequence If true, also validates boardSequence matches.
 */
export async function validateProjectionIntegrity(
  state:            BoardStoreState,
  expected:         ProjectionChecksum,
  enforceSequence = false,
): Promise<IntegrityCheckResult> {

  const current = await computeProjectionChecksum(state);

  if (enforceSequence && current.sequence !== expected.sequence) {
    return {
      valid:        false,
      checksum:     current,
      expectedHash: expected.hash,
      sequence:     expected.sequence,
      reason:       "SEQUENCE_MISMATCH",
    };
  }

  if (current.hash !== expected.hash) {
    return {
      valid:        false,
      checksum:     current,
      expectedHash: expected.hash,
      sequence:     expected.sequence,
      reason:       "HASH_MISMATCH",
    };
  }

  return { valid: true, checksum: current };
}

// ============================================================================
// 5.  ProjectionRebuildEngine
//     Deterministic replay from a snapshot + ordered event delta.
// ============================================================================

export interface RebuildOptions {
  /**
   * Optional base snapshot to start replay from.
   * If omitted, replay starts from empty state.
   */
  baseSnapshot?: BoardStoreState;

  /**
   * Ordered list of events to replay.
   * Must be in global sequence order (ascending).
   */
  events: readonly AppDomainEvent[];

  /**
   * The board sequence after the last event in the list.
   * Written into the rebuilt state's boardSequence field.
   */
  targetSequence: string;
}

export interface RebuildResult {
  state:    BoardStoreState;
  checksum: ProjectionChecksum;
  /** Number of events that were applied (vs total supplied). */
  appliedCount:  number;
  /** Number of events that were silently skipped (unknown type / stale). */
  skippedCount:  number;
}

/**
 * Deterministically replays a sequence of domain events onto a base state.
 *
 * Rules:
 *   • Reducer stale-protection prevents double-application.
 *   • Unknown event types are silently skipped (forward-compatibility).
 *   • The returned state has boardSequence = targetSequence.
 *   • A SHA-256 checksum is computed over the rebuilt projection.
 */
export async function rebuildProjection(
  opts: RebuildOptions,
): Promise<RebuildResult> {

  // Start from provided snapshot or blank slate.
  let state: BoardStoreState = opts.baseSnapshot
    ? structuredClone(opts.baseSnapshot)
    : createBoardState();

  let appliedCount = 0;
  let skippedCount = 0;

  for (const domainEvent of opts.events) {
    const envelope: ClientEventEnvelope = {
      event:        domainEvent,
      optimistic:   false,
      acknowledged: true,
      replayed:     true,
    };

    const partial = applyEvent(state, envelope, { mode: "replay" });

    // If the reducer returned an empty object, count as skipped.
    if (Object.keys(partial).length === 0) {
      skippedCount++;
    } else {
      state = { ...state, ...partial };
      appliedCount++;
    }
  }

  // Stamp the final sequence.
  state = { ...state, boardSequence: opts.targetSequence };

  const checksum = await computeProjectionChecksum(state);

  return { state, checksum, appliedCount, skippedCount };
}

// ============================================================================
// 6.  Incremental rebuild helper
//     Replay only the delta between two known-good snapshots.
// ============================================================================

export interface IncrementalRebuildOptions {
  /** Verified snapshot at fromSequence. */
  fromSnapshot:   BoardStoreState;
  fromSequence:   string;
  /** Events with sequence > fromSequence and <= toSequence, ordered ASC. */
  deltaEvents:    readonly AppDomainEvent[];
  toSequence:     string;
}

/**
 * Applies only the delta events on top of a verified snapshot.
 * Cheaper than full replay when only a window of events has arrived.
 */
export async function incrementalRebuild(
  opts: IncrementalRebuildOptions,
): Promise<RebuildResult> {
  return rebuildProjection({
    baseSnapshot:   opts.fromSnapshot,
    events:         opts.deltaEvents,
    targetSequence: opts.toSequence,
  });
}
