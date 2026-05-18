// apps/web/src/features/board/store/event-application/applyListUpdated.ts

import type { ListUpdatedEvent } from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

/**
 * applyListUpdated — Pure Event Reducer
 *
 * Fixes applied:
 * ✅ Stale guard direction corrected:
 *    OLD (wrong):  existingList.revision >= event.version
 *    NEW (correct): existingList.revision > event.version
 *    (same reasoning as applyCardUpdated)
 *
 * Rules:
 * - Pure, immutable, replay-safe, idempotent
 */
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

  // ✅ strictly-greater guard
  if (existingList.revision > event.version) {
    return {};
  }

  const updatedList = {
    ...existingList,
    ...changes,
    revision: event.version,
    isOptimistic: envelope.optimistic ?? false,
  };

  return {
    lists: {
      ...state.lists,
      [listId]: updatedList,
    },
  };
}
