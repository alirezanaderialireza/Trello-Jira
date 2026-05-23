// apps/web/src/features/board/store/sync/positioning/rebalancer.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// Detects when a position chain is approaching density limits and produces
// a complete set of replacement positions that evenly redistribute items.
//
// Two modes of operation:
//
//  1. Reactive (client-side only):
//     After every position computation, `detectCollision()` is checked.
//     If true, the rebalancer produces new positions for the ENTIRE chain
//     and returns a RebalancePlan — a map of { [entityId]: newPosition }.
//     The PositioningEngine applies this plan optimistically and sends it
//     to the server for authoritative confirmation.
//
//  2. Proactive (background sweep):
//     The PositioningEngine periodically scans all lists for chains that
//     have ANY position exceeding the threshold. It calls `analyzeChain()`
//     which returns diagnostic info + an optional RebalancePlan.
//
// ─── Design rules ────────────────────────────────────────────────────────────
//   • Pure — no store reads, no WS, no timers. Everything is injected.
//   • Deterministic — same input chain → same output plan.
//   • Delegates to @repo/domain's `generateBalancedPositions(count)` for
//     the actual position generation, which guarantees even spacing.
//   • Never mutates the input arrays.
//   • Operates on opaque Position strings — no internal Base62 decoding.
//
// ─── Integration contract ────────────────────────────────────────────────────
//   • PositioningEngine calls `needsRebalance(chain)` after every move.
//   • If true, calls `buildRebalancePlan(entityIds, currentPositions)`.
//   • Engine applies the plan locally (optimistic) then sends to server.
//   • Server may reject (OCC) — engine rolls back via snapshot.
// ─────────────────────────────────────────────────────────────────────────────

import {
  generateBalancedPositions,
  shouldRebalancePosition,
  comparePositions,
  type Position,
} from "@repo/domain/ordering";

import { telemetry } from "@/lib/telemetry/logEvent";

// ============================================================================
// 1.  Public types
// ============================================================================

/**
 * A plan that maps each entity ID to its new rebalanced position.
 * The engine iterates this map and applies all position updates atomically.
 */
export interface RebalancePlan {
  /** Map of entityId → newPosition */
  readonly assignments: ReadonlyMap<string, Position>;
  /** Diagnostic: how many positions in the chain triggered the threshold. */
  readonly hotCount: number;
  /** Diagnostic: max position string length before rebalance. */
  readonly maxLengthBefore: number;
  /** Diagnostic: max position string length after rebalance. */
  readonly maxLengthAfter: number;
}

/**
 * Diagnostic result from analyzeChain — tells the engine whether a rebalance
 * is needed and, if so, provides the plan.
 */
export interface ChainAnalysis {
  /** True when at least one position in the chain exceeds the threshold. */
  readonly needsRebalance: boolean;
  /** Number of positions that individually exceed the threshold. */
  readonly hotCount: number;
  /** Maximum position string length in the chain. */
  readonly maxLength: number;
  /** Total items in the chain. */
  readonly chainLength: number;
  /**
   * The rebalance plan, if needsRebalance is true.
   * Null when the chain is healthy.
   */
  readonly plan: RebalancePlan | null;
}

/** Threshold configuration — injectable for testing. */
export interface RebalanceConfig {
  /**
   * Minimum number of hot positions required to trigger a full rebalance.
   * Setting to 1 means any single dense position triggers rebalance.
   * Default: 1
   */
  readonly hotThreshold: number;

  /**
   * Maximum chain length that the balanced generator can handle in a single
   * pass. Beyond this, the rebalancer splits into segments.
   * Default: 60 (POSITION_BASE - 2 ensures single-char positions)
   */
  readonly maxSegmentSize: number;
}

const DEFAULT_CONFIG: RebalanceConfig = {
  hotThreshold: 1,
  maxSegmentSize: 60, // Base62 - 2 safety margin
};

// ============================================================================
// 2.  needsRebalance — quick O(n) scan
// ============================================================================

/**
 * Returns true when ANY position in the chain exceeds the density threshold.
 * Called after every computeInsertPosition / computeMovePosition.
 *
 * @param positions  The full list of positions in the chain (order irrelevant).
 */
export function needsRebalance(positions: readonly Position[]): boolean {
  for (const pos of positions) {
    if (shouldRebalancePosition(pos)) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// 3.  analyzeChain — full diagnostic
// ============================================================================

/**
 * Analyzes a position chain and optionally produces a rebalance plan.
 *
 * @param entityIds   Ordered array of entity IDs (same order as positions).
 * @param positions   Corresponding position for each entity (same order).
 * @param config      Optional configuration overrides.
 */
export function analyzeChain(
  entityIds: readonly string[],
  positions: readonly Position[],
  config: RebalanceConfig = DEFAULT_CONFIG,
): ChainAnalysis {
  if (entityIds.length !== positions.length) {
    throw new Error(
      `[Rebalancer] entityIds.length (${entityIds.length}) !== positions.length (${positions.length})`,
    );
  }

  const chainLength = entityIds.length;

  if (chainLength === 0) {
    return { needsRebalance: false, hotCount: 0, maxLength: 0, chainLength: 0, plan: null };
  }

  let hotCount  = 0;
  let maxLength = 0;

  for (const pos of positions) {
    if (pos.length > maxLength) maxLength = pos.length;
    if (shouldRebalancePosition(pos)) hotCount++;
  }

  const shouldRebalanceNow = hotCount >= config.hotThreshold;

  if (!shouldRebalanceNow) {
    return { needsRebalance: false, hotCount, maxLength, chainLength, plan: null };
  }

  // Build the plan.
  const plan = buildRebalancePlan(entityIds, positions, config);

  return {
    needsRebalance: true,
    hotCount,
    maxLength,
    chainLength,
    plan,
  };
}

// ============================================================================
// 4.  buildRebalancePlan — deterministic redistribution
// ============================================================================

/**
 * Produces a complete set of new positions that evenly space all items.
 *
 * Algorithm:
 *   1. Sort the entity/position pairs by current position (ascending).
 *   2. Generate `count` balanced positions via domain primitive.
 *   3. Assign them in order.
 *
 * The generated positions are single-character (when count ≤ 60) or
 * two-character, drastically compressing any previously deep chains.
 *
 * @param entityIds   Entity IDs in their current display order.
 * @param positions   Corresponding positions (same order as entityIds).
 * @param config      Configuration.
 * @returns           A RebalancePlan with the new assignments.
 */
export function buildRebalancePlan(
  entityIds: readonly string[],
  positions: readonly Position[],
  config: RebalanceConfig = DEFAULT_CONFIG,
): RebalancePlan {
  const count = entityIds.length;

  if (count === 0) {
    return {
      assignments: new Map(),
      hotCount: 0,
      maxLengthBefore: 0,
      maxLengthAfter: 0,
    };
  }

  // ── Step 1: Sort by current position to establish canonical order ────────
  const indexed = entityIds.map((id, i) => ({ id, position: positions[i]! }));
  indexed.sort((a, b) => comparePositions(a.position, b.position) || a.id.localeCompare(b.id));

  // ── Step 2: Generate balanced positions ──────────────────────────────────
  // For large chains that exceed maxSegmentSize, we use multi-level generation.
  const newPositions = generateBalancedPositionsForCount(count, config.maxSegmentSize);

  // ── Step 3: Build assignment map ─────────────────────────────────────────
  const assignments = new Map<string, Position>();
  let maxLengthAfter = 0;

  for (let i = 0; i < count; i++) {
    const newPos = newPositions[i]!;
    assignments.set(indexed[i]!.id, newPos);
    if (newPos.length > maxLengthAfter) maxLengthAfter = newPos.length;
  }

  // ── Diagnostic ───────────────────────────────────────────────────────────
  let hotCount      = 0;
  let maxLengthBefore = 0;
  for (const pos of positions) {
    if (pos.length > maxLengthBefore) maxLengthBefore = pos.length;
    if (shouldRebalancePosition(pos)) hotCount++;
  }

  telemetry.log("STORE", "REBALANCE_PLAN_BUILT", {
    chainLength:     count,
    hotCount,
    maxLengthBefore,
    maxLengthAfter,
  });

  return { assignments, hotCount, maxLengthBefore, maxLengthAfter };
}

// ============================================================================
// 5.  Multi-level balanced generation
// ============================================================================

/**
 * Wraps @repo/domain's generateBalancedPositions with support for counts
 * exceeding the single-character capacity (>60 items).
 *
 * Strategy for large counts:
 *   - Split into segments of maxSegmentSize.
 *   - Generate top-level positions for segments.
 *   - For each segment, generate sub-positions prefixed by the segment position.
 *
 * For most boards (< 60 items in a list), this returns single-char positions
 * directly from the domain primitive — O(n) and trivially fast.
 */
function generateBalancedPositionsForCount(
  count: number,
  maxSegmentSize: number,
): Position[] {
  // Fast path: fits in a single segment.
  if (count <= maxSegmentSize) {
    return generateBalancedPositions(count) as Position[];
  }

  // Multi-level: divide into segments.
  const segmentCount = Math.ceil(count / maxSegmentSize);
  const segmentPositions = generateBalancedPositions(segmentCount) as Position[];

  const result: Position[] = [];

  for (let seg = 0; seg < segmentCount; seg++) {
    const segPrefix = segmentPositions[seg]!;
    const segStart  = seg * maxSegmentSize;
    const segEnd    = Math.min(segStart + maxSegmentSize, count);
    const segSize   = segEnd - segStart;

    const subPositions = generateBalancedPositions(segSize) as Position[];

    for (const sub of subPositions) {
      result.push((segPrefix + sub) as Position);
    }
  }

  return result;
}

// ============================================================================
// 6.  Compression utility
// ============================================================================

/**
 * Checks if a chain would benefit from compression (rebalance).
 * Returns the average position length — useful for observability dashboards.
 *
 * Rule of thumb:
 *   avgLength ≤ 2  → healthy
 *   avgLength 3-4  → acceptable
 *   avgLength > 4  → proactive rebalance recommended
 */
export function chainDensityScore(positions: readonly Position[]): {
  avgLength: number;
  maxLength: number;
  count: number;
} {
  if (positions.length === 0) {
    return { avgLength: 0, maxLength: 0, count: 0 };
  }

  let totalLength = 0;
  let maxLength   = 0;

  for (const pos of positions) {
    totalLength += pos.length;
    if (pos.length > maxLength) maxLength = pos.length;
  }

  return {
    avgLength: totalLength / positions.length,
    maxLength,
    count: positions.length,
  };
}

// ============================================================================
// 7.  Re-export config type for DI in tests
// ============================================================================
// Note: RebalanceConfig is already exported at its declaration above (line 85).
// No need to re-export it here.
