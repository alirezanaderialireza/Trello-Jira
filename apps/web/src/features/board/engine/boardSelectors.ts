// apps/web/src/features/board/engine/boardSelectors.ts
//
// Phase 1.3 (F1.3.1) — pure Zustand selector factories for the board store.
//
// Deliberately free of any runtime import (the store/React types are imported
// `type`-only and erased at compile time). Keeping these pure means they can
// be unit-tested in isolation — no React tree, no Zustand instance — and the
// `useBoardState` hooks simply wrap them in `useMemo` for a stable
// subscription path.

import type { BoardStoreState, CardDto, ListDto } from "../store/useBoardStore";

// Stable empty — never hand out a fresh array for a missing slice, or the
// `Object.is` bail-out in Zustand would never fire and consumers would
// re-render on every unrelated store change.
export const EMPTY_CARD_IDS: readonly string[] = Object.freeze([]);

export const selectListOrder = (s: BoardStoreState): string[] => s.listOrder;

export const selectCardIds =
  (listId: string) =>
  (s: BoardStoreState): string[] =>
    s.cardsByList[listId] ?? (EMPTY_CARD_IDS as string[]);

export const selectCard =
  (cardId: string) =>
  (s: BoardStoreState): CardDto | undefined =>
    s.cards[cardId];

export const selectList =
  (listId: string) =>
  (s: BoardStoreState): ListDto | undefined =>
    s.lists[listId];

export const selectCardTitle =
  (cardId: string) =>
  (s: BoardStoreState): string | undefined =>
    s.cards[cardId]?.title;

/**
 * Pure projection of `listOrder` + `lists` → ordered list DTOs. Extracted so
 * the memoised hook and the unit test share one implementation.
 */
export function deriveOrderedLists(
  listOrder: string[],
  lists: Record<string, ListDto>,
): ListDto[] {
  return listOrder
    .map((id) => lists[id])
    .filter((l): l is ListDto => Boolean(l));
}
