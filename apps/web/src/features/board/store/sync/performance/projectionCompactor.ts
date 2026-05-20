// apps/web/src/features/board/store/sync/performance/projectionCompactor.ts
//
// Incremental snapshot compaction + delta serialization for large boards.
// Reduces bandwidth and storage by transmitting only changed slices.

import type { BoardStoreState, BoardSnapshot } from "../../useBoardStore";
import { computeChecksumSync, type Checksum } from "../canonicalSerializer";

export interface CompactionResult {
  readonly delta: Partial<BoardSnapshot>;
  readonly removedEntityIds: string[];
  readonly compressedSize: number;
  readonly checksum: Checksum;
}


export interface CompactorConfig {
  /** Max age (ms) for activity entries before compaction. Default: 24h. */
  readonly activityMaxAgeMs: number;
  /** Max snapshot delta size (bytes) before full snapshot. Default: 50KB. */
  readonly maxDeltaSizeBytes: number;
}

const DEFAULT_CONFIG: CompactorConfig = {
  activityMaxAgeMs: 24 * 60 * 60 * 1000,
  maxDeltaSizeBytes: 50_000,
};

/**
 * Computes a delta snapshot between two states (before/after).
 * Only includes slices that have actually changed (referential inequality).
 */
export function computeDelta(
  before: BoardStoreState,
  after: BoardStoreState,
): Partial<BoardSnapshot> {
  const delta: Partial<BoardSnapshot> = {};

  if (before.cards !== after.cards) delta.cards = after.cards;
  if (before.lists !== after.lists) delta.lists = after.lists;
  if (before.cardsByList !== after.cardsByList) delta.cardsByList = after.cardsByList;
  if (before.listOrder !== after.listOrder) delta.listOrder = after.listOrder;
  if (before.labels !== after.labels) delta.labels = after.labels;
  if (before.checklists !== after.checklists) delta.checklists = after.checklists;
  if (before.comments !== after.comments) delta.comments = after.comments;
  if (before.attachments !== after.attachments) delta.attachments = after.attachments;
  if (before.templates !== after.templates) delta.templates = after.templates;

  return delta;
}

/**
 * Compacts the activity feed by removing entries older than maxAge.
 * Returns the compacted state (new activityFeed array).
 */
export function compactActivityFeed(
  state: BoardStoreState,
  config: CompactorConfig = DEFAULT_CONFIG,
): BoardStoreState {
  const now = Date.now();
  const cutoff = now - config.activityMaxAgeMs;

  const compacted = state.activityFeed.filter(
    (entry) => new Date(entry.timestamp).getTime() > cutoff,
  );

  if (compacted.length === state.activityFeed.length) return state;

  return { ...state, activityFeed: compacted };
}

/**
 * Produces a compact snapshot suitable for transmission or persistence.
 * Includes checksum for integrity verification on the receiving end.
 */
export function createCompactSnapshot(
  state: BoardStoreState,
  config: CompactorConfig = DEFAULT_CONFIG,
): CompactionResult {
  // Compact activity first
  const compactedState = compactActivityFeed(state, config);

  // Build delta from empty (full snapshot but compacted)
  const delta: Partial<BoardSnapshot> = {
    cards: compactedState.cards,
    lists: compactedState.lists,
    cardsByList: compactedState.cardsByList,
    listOrder: compactedState.listOrder,
    labels: compactedState.labels,
    checklists: compactedState.checklists,
    comments: compactedState.comments,
    attachments: compactedState.attachments,
    templates: compactedState.templates,
  };

  const serialized = JSON.stringify(delta);
  const checksum = computeChecksumSync(delta);

  return {
    delta,
    removedEntityIds: [],
    compressedSize: serialized.length,
    checksum,
  };
}
