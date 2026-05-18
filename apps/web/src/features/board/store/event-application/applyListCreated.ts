// apps/web/src/features/board/store/event-application/applyListCreated.ts

import type { ListCreatedEvent } from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

/**
 * applyListCreated — Pure Event Reducer
 *
 * Fixes applied:
 * ✅ revision uses event.version directly — no unsafe cast.
 *    DomainEvent.version is a plain number; we have full type safety via
 *    ClientEventEnvelope<ListCreatedEvent>.
 *
 * Rules:
 * - Pure, immutable, replay-safe, idempotent, deterministic sort
 */
export function applyListCreated(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<ListCreatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;
  const { listId, title, position } = event.payload;

  const existingList = state.lists[listId];

  // ------------------------------------------------------------------
  // Stale & Idempotency guard
  // ------------------------------------------------------------------
  if (existingList && existingList.revision >= event.version) {
    return {};
  }

  const newList = {
    ...(existingList ?? {}),
    id: listId,
    title,
    position,
    revision: event.version,          // ✅ direct — no cast
    isOptimistic: envelope.optimistic ?? false,
  };

  // Idempotent insert
  const isAlreadyInOrder = state.listOrder.includes(listId);
  const nextListOrder = isAlreadyInOrder
    ? [...state.listOrder]
    : [...state.listOrder, listId];

  // Deterministic stable sort
  nextListOrder.sort((a, b) => {
    const posA = a === listId ? newList.position : (state.lists[a]?.position ?? "");
    const posB = b === listId ? newList.position : (state.lists[b]?.position ?? "");
    return posA.localeCompare(posB) || a.localeCompare(b);
  });

  return {
    lists: {
      ...state.lists,
      [listId]: newList,
    },
    listOrder: nextListOrder,
    cardsByList: {
      ...state.cardsByList,
      [listId]: state.cardsByList[listId] ?? [],
    },
  };
}
