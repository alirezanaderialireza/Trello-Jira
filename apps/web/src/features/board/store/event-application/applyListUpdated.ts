import type { ListUpdatedEvent } from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

export function applyListUpdated(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<ListUpdatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;
  const { listId, changes } = event.payload;

  const existingList = state.lists[listId];

  if (!existingList) {
    return {};
  }

  // 🌟 Stale Protection Guard
  if (existingList.revision >= event.version) {
    return {};
  }

  const updatedList = {
    ...existingList,
    ...changes,
    revision: event.version,
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