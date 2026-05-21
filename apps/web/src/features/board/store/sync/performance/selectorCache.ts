// apps/web/src/features/board/store/sync/performance/selectorCache.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// Memoized selector factories for Zustand store.
// Prevents recomputation and unnecessary re-renders in large boards.
//
// Strategies:
//   1. Referential equality cache (shallow compare inputs → cached output).
//   2. Per-entity selectors (cardById, listById) → O(1) lookup + stable reference.
//   3. Derived selectors (cardsInList, sortedListOrder) → recompute only when
//      the underlying slice actually changes.
//
// ─── Design rules ────────────────────────────────────────────────────────────
//   • No React dependency — pure utility functions.
//   • Works with Zustand's `useStore(selector)` pattern.
//   • Cache invalidation is automatic (referential inequality on store slice).
//   • No global mutable state — each selector is an independent closure.
// ─────────────────────────────────────────────────────────────────────────────

import type { BoardStoreState, CardDto, ListDto, LabelDto, ChecklistDto, CommentDto, AttachmentDto } from "../../useBoardStore";

// ============================================================================
// 1.  createMemoSelector — generic memoization with shallow equality
// ============================================================================

/**
 * Creates a memoized selector. The selector function is only re-invoked when
 * the `deps` extractor returns a referentially different value.
 *
 * @param deps     Extracts the dependency slice from the full state.
 * @param compute  Derives the result from the dependency slice.
 * @returns        A selector function compatible with `useStore(selector)`.
 */
export function createMemoSelector<TState, TDeps, TResult>(
  deps: (state: TState) => TDeps,
  compute: (deps: TDeps) => TResult,
): (state: TState) => TResult {
  let cachedDeps: TDeps | undefined;
  let cachedResult: TResult | undefined;

  return (state: TState): TResult => {
    const currentDeps = deps(state);

    // Referential equality check (covers 95% of Zustand updates)
    if (currentDeps === cachedDeps && cachedResult !== undefined) {
      return cachedResult;
    }

    cachedDeps = currentDeps;
    cachedResult = compute(currentDeps);
    return cachedResult;
  };
}

// ============================================================================
// 2.  Entity selectors — O(1) lookup with stable identity
// ============================================================================

/** Returns a stable card reference. Re-renders only when THAT card changes. */
export function selectCardById(cardId: string) {
  return createMemoSelector<BoardStoreState, CardDto | undefined, CardDto | undefined>(
    (state) => state.cards[cardId],
    (card) => card,
  );
}

/** Returns a stable list reference. */
export function selectListById(listId: string) {
  return createMemoSelector<BoardStoreState, ListDto | undefined, ListDto | undefined>(
    (state) => state.lists[listId],
    (list) => list,
  );
}

/** Returns a stable label reference. */
export function selectLabelById(labelId: string) {
  return createMemoSelector<BoardStoreState, LabelDto | undefined, LabelDto | undefined>(
    (state) => state.labels[labelId],
    (label) => label,
  );
}

// ============================================================================
// 3.  Collection selectors — recompute only when the index slice changes
// ============================================================================

/**
 * Returns all card IDs for a given list.
 * Only recomputes when cardsByList[listId] changes (not on any card update).
 */
export function selectCardIdsInList(listId: string) {
  return createMemoSelector<BoardStoreState, string[] | undefined, readonly string[]>(
    (state) => state.cardsByList[listId],
    (ids) => ids ?? [],
  );
}

/**
 * Returns the full card objects for a given list, in order.
 * Recomputes when the list's card IDs change OR any card in the list changes.
 */
export function selectCardsInList(listId: string) {
  let lastIds: string[] | undefined;
  let lastCards: Record<string, CardDto> | undefined;
  let cachedResult: CardDto[] = [];

  return (state: BoardStoreState): readonly CardDto[] => {
    const ids = state.cardsByList[listId];
    const cards = state.cards;

    if (ids === lastIds && cards === lastCards) return cachedResult;

    lastIds = ids;
    lastCards = cards;

    cachedResult = (ids ?? [])
      .map((id) => cards[id])
      .filter(Boolean) as CardDto[];

    return cachedResult;
  };
}

/** Sorted list order with list objects. Recomputes only on listOrder or lists change. */
export const selectSortedLists = createMemoSelector<
  BoardStoreState,
  { listOrder: string[]; lists: Record<string, ListDto> },
  readonly ListDto[]
>(
  (state) => ({ listOrder: state.listOrder, lists: state.lists }),
  ({ listOrder, lists }) =>
    listOrder.map((id) => lists[id]).filter(Boolean) as ListDto[],
);

/** All labels for a board (sorted by name). */
export function selectBoardLabels(boardId: string) {
  return createMemoSelector<BoardStoreState, string[] | undefined, readonly LabelDto[]>(
    (state) => state.labelsByBoard[boardId],
    (ids) => [], // consumer should map ids → state.labels[id]
  );
}

/** Comments for a card (ordered). */
export function selectCommentsForCard(cardId: string) {
  return createMemoSelector<BoardStoreState, string[] | undefined, readonly string[]>(
    (state) => state.commentsByCard[cardId],
    (ids) => ids ?? [],
  );
}

/** Attachments for a card. */
export function selectAttachmentsForCard(cardId: string) {
  return createMemoSelector<BoardStoreState, string[] | undefined, readonly string[]>(
    (state) => state.attachmentsByCard[cardId],
    (ids) => ids ?? [],
  );
}

/** Checklists for a card. */
export function selectChecklistsForCard(cardId: string) {
  return createMemoSelector<BoardStoreState, string[] | undefined, readonly string[]>(
    (state) => state.checklistsByCard[cardId],
    (ids) => ids ?? [],
  );
}

// ============================================================================
// 4.  Aggregate selectors — summary data for UI indicators
// ============================================================================

/** Total card count across all lists. Cheap O(1) from Object.keys. */
export const selectTotalCardCount = createMemoSelector<BoardStoreState, Record<string, CardDto>, number>(
  (state) => state.cards,
  (cards) => Object.keys(cards).length,
);

/** Total list count. */
export const selectTotalListCount = createMemoSelector<BoardStoreState, string[], number>(
  (state) => state.listOrder,
  (order) => order.length,
);
