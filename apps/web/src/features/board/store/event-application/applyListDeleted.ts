// apps/web/src/features/board/store/event-application/applyListDeleted.ts

import type { ListDeletedEvent } from "@repo/domain";
import type { BoardStoreState, CardDto } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

/**
 * ------------------------------------------------------------------
 * applyListDeleted
 * ------------------------------------------------------------------
 *
 * Pure Event Reducer
 *
 * Responsibilities:
 *  - Atomic list removal (lists, listOrder, cardsByList)
 *  - Cascade: remove every card belonging to the deleted list
 *  - Stale event protection
 *
 * Stale-protection note (terminal-state semantics):
 *  We use STRICT `>` (not `>=`) because deletion is a terminal
 *  state. If `existingList.revision === event.version` we still
 *  want to apply the delete (it is the very revision that the
 *  delete event was issued against).
 *
 * Rules:
 *  ✅ Pure
 *  ✅ Immutable
 *  ✅ Replay-safe
 *  ✅ Idempotent (deleting a missing list is a no-op)
 *  ✅ Stale-protected (only against newer revisions)
 * ------------------------------------------------------------------
 */
export function applyListDeleted(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<ListDeletedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;
  const { listId } = event.payload;

  const existingList = state.lists[listId];

  // 🛡️ Idempotency: deleting an absent list is a safe no-op.
  if (!existingList) {
    return {};
  }

  /**
   * 🛡️ Stale Protection (terminal-state semantics — strict `>`)
   * dual-revision aware: server events compare against confirmedRevision,
   * optimistic events against revision.
   */
  if (envelope.acknowledged) {
    if (existingList.confirmedRevision > event.version) {
      return {};
    }
  } else {
    if (existingList.revision > event.version) {
      return {};
    }
  }

  // Remove list itself
  const { [listId]: _removedList, ...remainingLists } = state.lists;

  // Remove cardsByList bucket and capture child cardIds for cascade
  const childCardIds = state.cardsByList[listId] ?? [];
  const { [listId]: _removedBucket, ...remainingCardsByList } =
    state.cardsByList;

  // Cascade: remove every card whose listId === deleted listId.
  // We iterate `state.cards` rather than trusting `cardsByList` alone,
  // because parallel mutations may have left a card with stale listId
  // pointing here that is not in the bucket.
  let nextCards: Record<string, CardDto> = state.cards;
  let cardsChanged = false;

  Object.entries(state.cards).forEach(([cardId, card]) => {
    if (card.listId === listId || childCardIds.includes(cardId)) {
      if (!cardsChanged) {
        nextCards = { ...state.cards };
        cardsChanged = true;
      }
      delete nextCards[cardId];
    }
  });

  return {
    lists: remainingLists,
    cardsByList: remainingCardsByList,
    listOrder: state.listOrder.filter((id) => id !== listId),
    ...(cardsChanged ? { cards: nextCards } : {}),
  };
}
