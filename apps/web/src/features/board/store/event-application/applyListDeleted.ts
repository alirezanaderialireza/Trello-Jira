// apps/web/src/features/board/store/event-application/applyListDeleted.ts

import type { ListDeletedEvent } from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

/**
 * applyListDeleted
 * ─────────────────
 * Pure reducer. Removes list + its cardsByList bucket from state.
 * Cards themselves are NOT removed (server sends card.deleted events separately).
 *
 * Rules:
 * ✅ Pure  ✅ Immutable  ✅ Replay-safe  ✅ Idempotent
 */
export function applyListDeleted(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<ListDeletedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { listId } = envelope.event.payload;

  // Idempotency: if list doesn't exist, nothing to do
  if (!state.lists[listId]) {
    return {};
  }

  const { [listId]: _removedList, ...remainingLists } = state.lists;
  const { [listId]: _removedCards, ...remainingCardsByList } = state.cardsByList;

  return {
    lists: remainingLists,
    cardsByList: remainingCardsByList,
    listOrder: state.listOrder.filter((id) => id !== listId),
  };
}
