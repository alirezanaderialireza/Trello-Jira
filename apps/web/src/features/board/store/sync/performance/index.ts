// apps/web/src/features/board/store/sync/performance/index.ts
//
// ─── Barrel export for the Performance & Scale module ────────────────────────

export { EventBatcher } from "./eventBatcher";
export type { BatchableEvent, EventPriority, BatcherConfig, BatchFlushResult, FlushCallback } from "./eventBatcher";

export { BackpressureController, backpressure } from "./backpressure";
export type { BackpressureMode, BackpressureConfig, BackpressureSnapshot } from "./backpressure";

export {
  createMemoSelector,
  selectCardById, selectListById, selectLabelById,
  selectCardIdsInList, selectCardsInList, selectSortedLists,
  selectBoardLabels, selectCommentsForCard, selectAttachmentsForCard, selectChecklistsForCard,
  selectTotalCardCount, selectTotalListCount,
} from "./selectorCache";

export {
  computeDelta, compactActivityFeed, createCompactSnapshot,
} from "./projectionCompactor";
export type { CompactionResult, CompactorConfig } from "./projectionCompactor";

export {
  computeVisibleLists, computeVisibleCards, computeVirtualWindow,
  computeTotalContentWidth, computeTotalContentHeight,
} from "./virtualRenderer";
export type { ViewportRect, ItemDimensions, VisibleRange, VirtualWindow } from "./virtualRenderer";
