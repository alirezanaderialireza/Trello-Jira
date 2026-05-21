// apps/web/src/features/board/store/event-application/applyListDeleted.ts
import type { ListDeletedEvent } from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

/**
 * applyListDeleted
 * ─────────────────────────────────────────────────────────────────
 * Pure reducer — idempotent, replay-safe, stale-protected.
 *
 * When a list is deleted:
 *   1. Remove the list entity from state.lists.
 *   2. Remove the list's card-index bucket from state.cardsByList.
 *   3. Remove the listId from state.listOrder.
 *
 * Cards that belonged to the list are NOT removed here — the server
 * must emit individual card.deleted events for each card so the
 * client can handle them idempotently.  Removing them here would
 * violate the single-responsibility rule of reducers and would break
 * replay ordering when card events arrive out of order.
 * ─────────────────────────────────────────────────────────────────
 */
export function applyListDeleted(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<ListDeletedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { listId } = envelope.event.payload;

  // Idempotency: if the list does not exist, nothing to do.
  if (!state.lists[listId]) return {};

  const { [listId]: _removedList, ...remainingLists }           = state.lists;
  const { [listId]: _removedBucket, ...remainingCardsByList }   = state.cardsByList;
  const nextListOrder = state.listOrder.filter((id) => id !== listId);

  return {
    lists:       remainingLists,
    cardsByList: remainingCardsByList,
    listOrder:   nextListOrder,
  };
}
