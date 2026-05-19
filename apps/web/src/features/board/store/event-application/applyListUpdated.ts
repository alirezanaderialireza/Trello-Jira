// apps/web/src/features/board/store/event-application/applyListUpdated.ts

import type { ListUpdatedEvent } from "@repo/domain";
import type { BoardStoreState, ListDto } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

/**
 * ------------------------------------------------------------------
 * applyListUpdated
 * ------------------------------------------------------------------
 * Responsibilities:
 * - apply title changes from payload
 * - propagate boardId from payload (defensive self-healing)
 * - stale protection via version check
 * ------------------------------------------------------------------
 */
export function applyListUpdated(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<ListUpdatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;

  // 🌟 Full canonical payload destructure
  const { listId, boardId, changes } = event.payload;

  const existingList = state.lists[listId];

  if (!existingList) {
    return {};
  }

  /**
   * 🛡️ Stale Protection — dual-revision aware (see applyCardMoved).
   */
  if (envelope.acknowledged) {
    if (existingList.confirmedRevision >= event.version) {
      return {};
    }
  } else {
    if (existingList.revision >= event.version) {
      return {};
    }
  }

  const updatedList: ListDto = {
    ...existingList,
    boardId: boardId ?? existingList.boardId,
    ...(changes.title !== undefined && { title: changes.title }),
    revision: event.version,
    confirmedRevision: envelope.acknowledged
      ? event.version
      : existingList.confirmedRevision,
    isOptimistic: envelope.acknowledged
      ? false
      : envelope.optimistic ?? existingList.isOptimistic ?? false,
  };

  return {
    lists: {
      ...state.lists,
      [listId]: updatedList,
    },
  };
}
