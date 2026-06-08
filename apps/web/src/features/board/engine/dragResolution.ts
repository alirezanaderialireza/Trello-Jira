// apps/web/src/features/board/engine/dragResolution.ts
//
// Phase 1.3 (F1.3.2) — pure drop-resolution helpers.
//
// These encode the index/container math that BoardView used to compute inline
// inside onDragOver/onDragEnd. Extracting them as pure functions makes the
// drag engine thin and lets us unit-test the tricky off-by-one / append /
// cross-list cases without a DnD runtime.
//
// `cardsByList` / `listOrder` are passed in as plain data (the caller reads
// them from the store), so nothing here touches React or Zustand.

export type CardsByList = Record<string, string[]>;

/**
 * The container a dragged item is over: dnd-kit gives us the sortable
 * containerId when hovering a card, but when hovering the empty area of a list
 * the `over.id` IS the list id. Prefer the explicit container, fall back to id.
 */
export function resolveOverListId(
  overContainerId: string | null | undefined,
  overId: string | null | undefined,
): string | null {
  return overContainerId || overId || null;
}

/**
 * Index of `cardId` within a list, or -1 if absent.
 */
export function indexOfCard(
  cardsByList: CardsByList,
  listId: string,
  cardId: string,
): number {
  const ids = cardsByList[listId];
  return ids ? ids.indexOf(cardId) : -1;
}

/**
 * The index in the destination list where the dragged card should land while
 * hovering over `overId`. When `overId` is not a card in the destination
 * (e.g. hovering the empty drop zone), the card appends to the end.
 */
export function computeOverIndex(
  cardsByList: CardsByList,
  overListId: string,
  overId: string,
): number {
  const ids = cardsByList[overListId] ?? [];
  const idx = ids.indexOf(overId);
  return idx === -1 ? ids.length : idx;
}

/**
 * Whether a visual move is needed: either the card changed lists, or its index
 * within the same list changed.
 */
export function needsVisualMove(
  activeListId: string,
  overListId: string,
  activeIndex: number,
  overIndex: number,
): boolean {
  return activeListId !== overListId || activeIndex !== overIndex;
}

export interface ListMoveIndices {
  fromIndex: number;
  toIndex: number;
  changed: boolean;
}

/**
 * Source/destination indices for a list reorder. `changed` is false when the
 * drop is a no-op (same slot) so the caller can skip the mutation entirely.
 */
export function computeListMoveIndices(
  listOrder: string[],
  activeListId: string,
  overListId: string,
): ListMoveIndices {
  const fromIndex = listOrder.indexOf(activeListId);
  const toIndex = listOrder.indexOf(overListId);
  return { fromIndex, toIndex, changed: fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex };
}
