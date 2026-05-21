// apps/web/src/features/board/store/sync/performance/virtualRenderer.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// Windowed rendering utilities for large boards.
// Only cards/lists within the visible viewport are rendered.
// Provides the calculation layer — actual React components use these
// computations to decide what to mount/unmount.
//
// ─── Design rules ────────────────────────────────────────────────────────────
//   • No React dependency — pure computation.
//   • Framework-agnostic — returns index ranges and visibility flags.
//   • Works with both horizontal (lists) and vertical (cards) axes.
// ─────────────────────────────────────────────────────────────────────────────

// ============================================================================
// 1.  Types
// ============================================================================

export interface ViewportRect {
  readonly scrollLeft: number;
  readonly scrollTop: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

export interface ItemDimensions {
  /** Fixed width of each list column (px). */
  readonly listWidth: number;
  /** Gap between list columns (px). */
  readonly listGap: number;
  /** Fixed height of each card row (px). Approximate for estimation. */
  readonly cardHeight: number;
  /** Gap between cards (px). */
  readonly cardGap: number;
}

export interface VisibleRange {
  /** First visible index (inclusive). */
  readonly startIndex: number;
  /** Last visible index (inclusive). */
  readonly endIndex: number;
  /** Total item count in the collection. */
  readonly totalCount: number;
}

export interface VirtualWindow {
  /** Visible list column range. */
  readonly lists: VisibleRange;
  /** Per-list visible card ranges. Key = listIndex within visible range. */
  readonly cardsByList: Map<number, VisibleRange>;
  /** Total rendered item count (for metrics). */
  readonly renderedCount: number;
}

const DEFAULT_DIMENSIONS: ItemDimensions = {
  listWidth: 288,  // w-72 = 18rem = 288px
  listGap: 16,
  cardHeight: 72,
  cardGap: 8,
};

/** Overscan: render N extra items outside viewport for smooth scrolling. */
const OVERSCAN_LISTS = 1;
const OVERSCAN_CARDS = 3;

// ============================================================================
// 2.  Computation functions
// ============================================================================

/**
 * Computes which list columns are visible in the horizontal viewport.
 */
export function computeVisibleLists(
  viewport: ViewportRect,
  totalLists: number,
  dims: ItemDimensions = DEFAULT_DIMENSIONS,
): VisibleRange {
  if (totalLists === 0) return { startIndex: 0, endIndex: -1, totalCount: 0 };

  const columnWidth = dims.listWidth + dims.listGap;
  const rawStart = Math.floor(viewport.scrollLeft / columnWidth);
  const visibleCount = Math.ceil(viewport.viewportWidth / columnWidth) + 1;

  const startIndex = Math.max(0, rawStart - OVERSCAN_LISTS);
  const endIndex = Math.min(totalLists - 1, rawStart + visibleCount + OVERSCAN_LISTS);

  return { startIndex, endIndex, totalCount: totalLists };
}

/**
 * Computes which cards are visible in a vertically-scrolled list container.
 */
export function computeVisibleCards(
  scrollTop: number,
  containerHeight: number,
  totalCards: number,
  dims: ItemDimensions = DEFAULT_DIMENSIONS,
): VisibleRange {
  if (totalCards === 0) return { startIndex: 0, endIndex: -1, totalCount: 0 };

  const rowHeight = dims.cardHeight + dims.cardGap;
  const rawStart = Math.floor(scrollTop / rowHeight);
  const visibleCount = Math.ceil(containerHeight / rowHeight) + 1;

  const startIndex = Math.max(0, rawStart - OVERSCAN_CARDS);
  const endIndex = Math.min(totalCards - 1, rawStart + visibleCount + OVERSCAN_CARDS);

  return { startIndex, endIndex, totalCount: totalCards };
}

/**
 * Computes the full virtual window for the board.
 */
export function computeVirtualWindow(
  viewport: ViewportRect,
  totalLists: number,
  cardCountPerList: readonly number[],
  listScrollTops: readonly number[],
  listContainerHeight: number,
  dims: ItemDimensions = DEFAULT_DIMENSIONS,
): VirtualWindow {
  const lists = computeVisibleLists(viewport, totalLists, dims);
  const cardsByList = new Map<number, VisibleRange>();
  let renderedCount = 0;

  for (let i = lists.startIndex; i <= lists.endIndex; i++) {
    const cardCount = cardCountPerList[i] ?? 0;
    const scrollTop = listScrollTops[i] ?? 0;
    const range = computeVisibleCards(scrollTop, listContainerHeight, cardCount, dims);
    cardsByList.set(i, range);
    renderedCount += Math.max(0, range.endIndex - range.startIndex + 1);
  }

  // Add visible list count
  renderedCount += Math.max(0, lists.endIndex - lists.startIndex + 1);

  return { lists, cardsByList, renderedCount };
}

/**
 * Computes the total content width for horizontal scrollbar sizing.
 */
export function computeTotalContentWidth(
  totalLists: number,
  dims: ItemDimensions = DEFAULT_DIMENSIONS,
): number {
  if (totalLists === 0) return 0;
  return totalLists * dims.listWidth + (totalLists - 1) * dims.listGap;
}

/**
 * Computes the total content height for a single list's vertical scrollbar.
 */
export function computeTotalContentHeight(
  totalCards: number,
  dims: ItemDimensions = DEFAULT_DIMENSIONS,
): number {
  if (totalCards === 0) return 0;
  return totalCards * dims.cardHeight + (totalCards - 1) * dims.cardGap;
}
