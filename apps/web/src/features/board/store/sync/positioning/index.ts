// apps/web/src/features/board/store/sync/positioning/index.ts
//
// ─── Barrel export for the Positioning Engine ────────────────────────────────
// Single import point for all consumers:
//
//   import { positioningEngine, computeInsertPosition, ... }
//     from "@/features/board/store/sync/positioning";
//
// ─────────────────────────────────────────────────────────────────────────────

// ── lexoRank — pure position computation ─────────────────────────────────────
export {
  computeInsertPosition,
  computeAppendPosition,
  computePrependPosition,
  computeMovePosition,
  detectCollision,
  sortByPosition,
  extractSortedPositions,
  extractSortedPositionsExcluding,
  // Re-exports from @repo/domain
  generatePosition,
  comparePositions,
  shouldRebalancePosition,
  PositionCollisionError,
} from "./lexoRank";
export type { Position } from "./lexoRank";

// ── rebalancer — threshold detection + plan generation ───────────────────────
export {
  needsRebalance,
  analyzeChain,
  buildRebalancePlan,
  chainDensityScore,
} from "./rebalancer";
export type {
  RebalancePlan,
  ChainAnalysis,
  RebalanceConfig,
} from "./rebalancer";

// ── positioningEngine — actor-based orchestrator (singleton) ─────────────────
export {
  PositioningEngine,
  positioningEngine,
} from "./positioningEngine";
export type {
  MoveCardResult,
  MoveListResult,
  InsertResult,
} from "./positioningEngine";
