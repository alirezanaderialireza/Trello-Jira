// apps/web/src/features/board/store/event-application/applyListMoved.ts

import type { ListMovedEvent } from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

/**
 * applyListMoved — Pure Event Reducer
 *
 * Fixes applied:
 * ✅ revision now uses event.version directly — no unsafe (event as any) cast.
 *    ClientEventEnvelope<ListMovedEvent> gives full type safety; DomainEvent.version
 *    is a plain number on the base interface.
 *
 * Rules:
 * - Pure, immutable, replay-safe, deterministic sort
 */
export function applyListMoved(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<ListMovedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;
  const { listId, newPosition } = event.payload;

  const existingList = state.lists[listId];

  if (!existingList) {
    return {};
  }

  const updatedList = {
    ...existingList,
    position: newPosition,
    revision: event.version,          // ✅ direct — no cast
    isOptimistic: envelope.optimistic ?? existingList.isOptimistic ?? false,
  };

  // Deterministic stable sort by LexoRank position, fallback to ID
  const nextListOrder = [...state.listOrder];

  nextListOrder.sort((a, b) => {
    const posA = a === listId ? updatedList.position : (state.lists[a]?.position ?? "");
    const posB = b === listId ? updatedList.position : (state.lists[b]?.position ?? "");
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
