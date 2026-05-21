// apps/web/src/features/board/store/event-application/applyListDeleted.ts

import type { ListDeletedEvent } from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

/**
 * applyListDeleted — Pure Event Reducer
 *
 * New file — previously missing, causing list.deleted WebSocket events
 * to be silently dropped by the dispatcher (unknown event → return {}).
 *
 * Responsibilities:
 * - Remove list from lists dict
 * - Remove list from listOrder
 * - Remove list bucket from cardsByList
 * - Remove all cards that belonged to this list from cards dict
 *
 * Rules:
 * - Pure, immutable, replay-safe, idempotent
 */
export function applyListDeleted(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<ListDeletedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;
  const { listId } = event.payload;

  // Idempotency: list already removed
  if (!state.lists[listId]) {
    return {};
  }

  // Collect card IDs that live in this list so we can purge them
  const orphanedCardIds = new Set(state.cardsByList[listId] ?? []);

  // Remove list entity
  const { [listId]: _removedList, ...remainingLists } = state.lists;

  // Remove list bucket
  const { [listId]: _removedBucket, ...remainingCardsByList } = state.cardsByList;

  // Remove orphaned cards from the cards dict
  const remainingCards: typeof state.cards = {};
  for (const [id, card] of Object.entries(state.cards)) {
    if (!orphanedCardIds.has(id)) {
      remainingCards[id] = card;
    }
  }

  return {
    lists: remainingLists,
    listOrder: state.listOrder.filter((id) => id !== listId),
    cardsByList: remainingCardsByList,
    cards: remainingCards,
  };
}
