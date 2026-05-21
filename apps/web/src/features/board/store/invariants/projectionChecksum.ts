// apps/web/src/features/board/store/invariants/projectionChecksum.ts
// ─────────────────────────────────────────────────────────────────────────────
// Projection Checksum Validation — state fingerprinting + corruption detection.
//
// Purpose:
//   After any projection rebuild (replay / resync / snapshot restore), compute
//   a canonical fingerprint of the entire BoardStoreState. Store the fingerprint
//   alongside the state. Before serving any read or applying any mutation,
//   re-compute and compare. Mismatch → corruption detected → trigger resync.
//
// Components:
//   1. computeProjectionFingerprint()  — async SHA-256 over the canonical state
//   2. computeProjectionFingerprintSync() — sync FNV-1a for hot-path checks
//   3. ProjectionChecksumRegistry     — stores fingerprints per boardId
//   4. verifyProjectionIntegrity()    — compare live state vs stored fingerprint
//   5. snapshotChecksum()             — fingerprint a BoardSnapshot for rollback validation
//
// Design:
//   - Pure functions — no mutations, no side effects
//   - Async path uses SHA-256 (cryptographic, 256-bit)
//   - Sync path uses FNV-1a (non-cryptographic, 32-bit, for devtools/invariants)
//   - Registry is per-session in-memory; survives tab refresh via sessionStorage
// ─────────────────────────────────────────────────────────────────────────────

import type { BoardStoreState, BoardSnapshot } from "../useBoardStore";
import {
  canonicalStringify,
  computeChecksum,
  computeChecksumSync,
} from "./canonicalSerializer";

// ============================================================================
// Types
// ============================================================================

export interface ProjectionFingerprint {
  boardId:      string;
  boardSequence: string;
  checksum:     string;
  algorithm:    "sha256" | "fnv1a32";
  computedAt:   number; // unix ms
  cardCount:    number;
  listCount:    number;
}

export interface CorruptionReport {
  boardId:        string;
  expectedChecksum: string;
  actualChecksum:  string;
  boardSequence:   string;
  detectedAt:      number;
  severity:        "critical";
}

// ============================================================================
// 1. computeProjectionFingerprint (async, SHA-256)
// ─────────────────────────────────────────────────────────────────────────────
// Fingerprints the projection-relevant fields of BoardStoreState:
//   lists, cards, cardsByList, listOrder, boardSequence
// Excludes runtime-only fields: bufferedEvents, pendingMutations, syncStatus
// ============================================================================

export async function computeProjectionFingerprint(
  boardId: string,
  state: BoardStoreState,
): Promise<ProjectionFingerprint> {
  const canonical = buildCanonicalProjection(state);
  const checksum  = await computeChecksum(canonical);

  return {
    boardId,
    boardSequence:  state.boardSequence,
    checksum,
    algorithm:      checksum.length === 64 ? "sha256" : "fnv1a32",
    computedAt:     Date.now(),
    cardCount:      Object.keys(state.cards).length,
    listCount:      Object.keys(state.lists).length,
  };
}

// ============================================================================
// 2. computeProjectionFingerprintSync (sync, FNV-1a 32-bit)
// ─────────────────────────────────────────────────────────────────────────────
// Hot-path version: called during invariant checks and devtools overlay.
// Not cryptographic — use only for corruption *detection*, not verification.
// ============================================================================

export function computeProjectionFingerprintSync(
  boardId: string,
  state: BoardStoreState,
): ProjectionFingerprint {
  const canonical = buildCanonicalProjection(state);
  const checksum  = computeChecksumSync(canonical);

  return {
    boardId,
    boardSequence:  state.boardSequence,
    checksum,
    algorithm:      "fnv1a32",
    computedAt:     Date.now(),
    cardCount:      Object.keys(state.cards).length,
    listCount:      Object.keys(state.lists).length,
  };
}

// Internal: builds the deterministic projection object to be fingerprinted.
// Only projection-relevant fields — runtime state excluded.
function buildCanonicalProjection(state: BoardStoreState): object {
  return {
    lists:        state.lists,
    cards:        state.cards,
    cardsByList:  state.cardsByList,
    listOrder:    state.listOrder,
    boardSequence: state.boardSequence,
  };
}

// ============================================================================
// 3. ProjectionChecksumRegistry
// ─────────────────────────────────────────────────────────────────────────────
// In-memory registry of known-good fingerprints, keyed by boardId.
// Persisted to sessionStorage so it survives React re-renders (but not
// hard refreshes — correct behaviour: fresh reload = fresh fingerprint).
// ============================================================================

const STORAGE_KEY_PREFIX = "pcr:";

export class ProjectionChecksumRegistry {
  private readonly store = new Map<string, ProjectionFingerprint>();

  /** Record a known-good fingerprint (call after successful rebuild/resync) */
  set(fingerprint: ProjectionFingerprint): void {
    this.store.set(fingerprint.boardId, fingerprint);
    try {
      sessionStorage.setItem(
        STORAGE_KEY_PREFIX + fingerprint.boardId,
        JSON.stringify(fingerprint),
      );
    } catch { /* sessionStorage unavailable (SSR/worker) — memory only */ }
  }

  /** Retrieve the last known-good fingerprint for a board */
  get(boardId: string): ProjectionFingerprint | null {
    if (this.store.has(boardId)) return this.store.get(boardId)!;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY_PREFIX + boardId);
      if (raw) {
        const fp = JSON.parse(raw) as ProjectionFingerprint;
        this.store.set(boardId, fp);
        return fp;
      }
    } catch { /* SSR/worker */ }
    return null;
  }

  /** Invalidate fingerprint (call when resync starts) */
  invalidate(boardId: string): void {
    this.store.delete(boardId);
    try { sessionStorage.removeItem(STORAGE_KEY_PREFIX + boardId); } catch { /**/ }
  }

  /** Clear all (call on logout or full board unload) */
  clear(): void {
    for (const boardId of this.store.keys()) this.invalidate(boardId);
  }
}

/** Module-level singleton registry */
export const checksumRegistry = new ProjectionChecksumRegistry();

// ============================================================================
// 4. verifyProjectionIntegrity
// ─────────────────────────────────────────────────────────────────────────────
// Compares the live state's fingerprint against the stored known-good one.
// Returns null if no stored fingerprint (first load → nothing to compare).
// Returns CorruptionReport if mismatch detected.
// ============================================================================

export async function verifyProjectionIntegrity(
  boardId: string,
  liveState: BoardStoreState,
): Promise<CorruptionReport | null> {
  const stored = checksumRegistry.get(boardId);
  if (!stored) return null; // No baseline yet — nothing to compare

  const liveFp = await computeProjectionFingerprint(boardId, liveState);

  if (liveFp.checksum === stored.checksum) return null; // ✅ Intact

  return {
    boardId,
    expectedChecksum: stored.checksum,
    actualChecksum:   liveFp.checksum,
    boardSequence:    liveState.boardSequence,
    detectedAt:       Date.now(),
    severity:         "critical",
  };
}

/** Synchronous version — uses FNV-1a for hot-path invariant checks */
export function verifyProjectionIntegritySync(
  boardId: string,
  liveState: BoardStoreState,
): CorruptionReport | null {
  const stored = checksumRegistry.get(boardId);
  if (!stored) return null;

  const liveChecksum = computeProjectionFingerprintSync(boardId, liveState).checksum;

  // Only compare if both are the same algorithm (fnv1a32 vs sha256 would always differ)
  if (stored.algorithm !== "fnv1a32") return null; // Can't compare sync vs async hash

  if (liveChecksum === stored.checksum) return null;

  return {
    boardId,
    expectedChecksum: stored.checksum,
    actualChecksum:   liveChecksum,
    boardSequence:    liveState.boardSequence,
    detectedAt:       Date.now(),
    severity:         "critical",
  };
}

// ============================================================================
// 5. snapshotChecksum
// ─────────────────────────────────────────────────────────────────────────────
// Fingerprints a BoardSnapshot for rollback validation.
// Used to verify that a snapshot hasn't been tampered with before applying it.
// ============================================================================

export async function snapshotChecksum(snapshot: BoardSnapshot): Promise<string> {
  return computeChecksum(snapshot);
}

export function snapshotChecksumSync(snapshot: BoardSnapshot): string {
  return computeChecksumSync(snapshot);
}

/**
 * Stamped snapshot: snapshot + its checksum, stored together.
 * Create on snapshot capture; verify before snapshot restore.
 */
export interface StampedSnapshot {
  snapshot:  BoardSnapshot;
  checksum:  string;
  stampedAt: number;
}

export async function stampSnapshot(snapshot: BoardSnapshot): Promise<StampedSnapshot> {
  return {
    snapshot,
    checksum:  await snapshotChecksum(snapshot),
    stampedAt: Date.now(),
  };
}

export async function verifyStampedSnapshot(stamped: StampedSnapshot): Promise<boolean> {
  const live = await snapshotChecksum(stamped.snapshot);
  return live === stamped.checksum;
}
