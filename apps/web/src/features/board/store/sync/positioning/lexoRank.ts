// apps/web/src/features/board/store/sync/positioning/lexoRank.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// Client-side facade over @repo/domain's LexoRank primitives.
// Provides higher-level operations for the positioning engine:
//
//   • computeInsertPosition(positions, targetIndex)
//       Given a sorted array of existing positions, compute the position
//       string that, when inserted, will sort to `targetIndex`.
//
//   • computeAppendPosition(positions)
//       Position for a new item at the end of the list.
//
//   • computePrependPosition(positions)
//       Position for a new item at the beginning of the list.
//
//   • detectCollision(position) → boolean
//       Returns true when the generated position is approaching density limits.
//
//   • sortByPosition<T>(items, positionFn) → T[]
//       Deterministic stable sort matching the reducer semantics.
//
// ─── Design rules ────────────────────────────────────────────────────────────
//   • Pure — no state reads, no side effects, no timers.
//   • Deterministic — same inputs → same outputs across tabs/workers.
//   • Delegates to @repo/domain primitives (generatePosition, comparePositions,
//     shouldRebalancePosition) — no reimplementation.
//   • Throws PositionCollisionError when density is exhausted — the caller
//     (positioningEngine) catches this and triggers rebalance.
// ─────────────────────────────────────────────────────────────────────────────

import {
  generatePosition,
  comparePositions,
  shouldRebalancePosition,
  type Position,
  PositionCollisionError,
} from "@repo/domain";

// ============================================================================
// 1.  computeInsertPosition
// ============================================================================

/**
 * Given a sorted (ascending) array of position strings and a target index,
 * computes the position that will sort to that index after insertion.
 *
 * @param sortedPositions  Existing positions in ascending order.
 * @param targetIndex      0-based index where the new item should appear.
 *                         0 = first, sortedPositions.length = last.
 * @returns                A new Position string.
 * @throws PositionCollisionError if midpoint space is exhausted.
 *
 * Examples:
 *   computeInsertPosition(["a", "m", "z"], 0)  → before "a"
 *   computeInsertPosition(["a", "m", "z"], 1)  → between "a" and "m"
 *   computeInsertPosition(["a", "m", "z"], 3)  → after "z"
 *   computeInsertPosition([], 0)               → initial position
 */
export function computeInsertPosition(
  sortedPositions: readonly Position[],
  targetIndex: number,
): Position {
  // Clamp index to valid range [0, length].
  const clamped = Math.max(0, Math.min(targetIndex, sortedPositions.length));

  const prev: Position | undefined = sortedPositions[clamped - 1];
  const next: Position | undefined = sortedPositions[clamped];

  return generatePosition(prev, next);
}

// ============================================================================
// 2.  computeAppendPosition
// ============================================================================

/**
 * Shorthand: compute a position that sorts after all existing items.
 */
export function computeAppendPosition(
  sortedPositions: readonly Position[],
): Position {
  return computeInsertPosition(sortedPositions, sortedPositions.length);
}

// ============================================================================
// 3.  computePrependPosition
// ============================================================================

/**
 * Shorthand: compute a position that sorts before all existing items.
 */
export function computePrependPosition(
  sortedPositions: readonly Position[],
): Position {
  return computeInsertPosition(sortedPositions, 0);
}

// ============================================================================
// 4.  computeMovePosition
// ============================================================================

/**
 * Compute the new position for an item that is being moved from one index
 * to another within the same list (or cross-list).
 *
 * @param sortedPositions  Positions of the TARGET list (already excluding
 *                         the moving item if it was in this list).
 * @param targetIndex      The 0-based index where the item should land.
 * @returns                A new Position string.
 */
export function computeMovePosition(
  sortedPositions: readonly Position[],
  targetIndex: number,
): Position {
  return computeInsertPosition(sortedPositions, targetIndex);
}

// ============================================================================
// 5.  detectCollision — density check
// ============================================================================

/**
 * Returns true when the position string is at risk of density exhaustion.
 * The PositioningEngine should trigger a rebalance when this returns true.
 */
export function detectCollision(position: Position): boolean {
  return shouldRebalancePosition(position);
}

// ============================================================================
// 6.  sortByPosition — deterministic stable sort
// ============================================================================

/**
 * Sorts items by their position string using the same semantics as
 * applyCardMoved / applyListMoved reducers (localeCompare + ID tiebreaker).
 *
 * @param items       Array of items to sort (not mutated — returns a new array).
 * @param positionFn  Extracts the Position from an item.
 * @param idFn        Extracts the ID for stable tiebreaker.
 */
export function sortByPosition<T>(
  items: readonly T[],
  positionFn: (item: T) => Position,
  idFn: (item: T) => string,
): T[] {
  return [...items].sort((a, b) => {
    const cmp = comparePositions(positionFn(a), positionFn(b));
    if (cmp !== 0) return cmp;
    return idFn(a).localeCompare(idFn(b));
  });
}

// ============================================================================
// 7.  extractSortedPositions — utility for reading from store projections
// ============================================================================

/**
 * Given an ordered array of IDs and a lookup map (id → entity with .position),
 * returns the positions in the same order.
 *
 * Skips IDs not found in the lookup (defensive against stale projections).
 */
export function extractSortedPositions(
  orderedIds: readonly string[],
  lookup: Record<string, { position: Position }>,
): Position[] {
  const result: Position[] = [];
  for (const id of orderedIds) {
    const entity = lookup[id];
    if (entity) {
      result.push(entity.position);
    }
  }
  return result;
}

/**
 * Same as extractSortedPositions but excludes one item (the item being moved).
 * This produces the "target list without the moving item" needed by computeMovePosition.
 */
export function extractSortedPositionsExcluding(
  orderedIds: readonly string[],
  lookup: Record<string, { position: Position }>,
  excludeId: string,
): Position[] {
  const result: Position[] = [];
  for (const id of orderedIds) {
    if (id === excludeId) continue;
    const entity = lookup[id];
    if (entity) {
      result.push(entity.position);
    }
  }
  return result;
}

// ============================================================================
// 8.  Re-export domain primitives for convenience
// ============================================================================

export {
  generatePosition,
  comparePositions,
  shouldRebalancePosition,
  PositionCollisionError,
};
export type { Position };
