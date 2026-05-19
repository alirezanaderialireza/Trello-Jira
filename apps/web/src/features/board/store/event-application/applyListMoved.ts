// apps/web/src/features/board/store/event-application/applyListMoved.ts

import type { ListMovedEvent } from "@repo/domain";

import type { BoardStoreState, ListDto } from "../useBoardStore";

import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

/**
 * ------------------------------------------------------------------
 * applyListMoved
 * ------------------------------------------------------------------
 *
 * Pure Event Reducer
 *
 * Responsibilities:
 * - move/reorder lists
 * - update LexoRank position
 * - propagate boardId from payload (defensive)
 * - maintain deterministic board ordering
 * - preserve replay safety
 * - support optimistic reconciliation
 *
 * Rules:
 * ✅ Pure
 * ✅ Immutable
 * ✅ Replay-safe
 * ✅ Stale-protected
 * ✅ Deterministic
 * ✅ Partial state return
 * ✅ Stable sorting
 * ------------------------------------------------------------------
 */

export function applyListMoved(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<ListMovedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;

  // 🌟 Full canonical payload destructure
  const {
    listId,
    boardId,
    newPosition,
  } = event.payload;

  const existingList = state.lists[listId];

  if (!existingList) {
    return {};
  }

  /**
   * Stale Protection: drop already-applied / superseded events.
   */
  if (existingList.revision >= event.version) {
    return {};
  }

  const updatedList: ListDto = {
    ...existingList,
    boardId: boardId ?? existingList.boardId,
    position: newPosition,
    revision: event.version,
    isOptimistic: envelope.acknowledged
      ? false
      : envelope.optimistic ?? existingList.isOptimistic ?? false,
  };

  const nextListOrder = [...state.listOrder];

  /**
   * Deterministic Stable Sort using updatedList.position (not stale state).
   */
  nextListOrder.sort((a, b) => {
    const posA =
      a === listId
        ? updatedList.position
        : state.lists[a]?.position ?? "";

    const posB =
      b === listId
        ? updatedList.position
        : state.lists[b]?.position ?? "";

    return posA.localeCompare(posB) || a.localeCompare(b);
  });

  return {
    lists: {
      ...state.lists,
      [listId]: updatedList,
    },
    listOrder: nextListOrder,
  };
}
