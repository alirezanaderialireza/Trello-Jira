// apps/web/src/features/board/store/event-application/applyListCreated.ts
//
// Phase-0 audit:
//   ✅ stale-safe      — existing list with higher revision → {}
//   ✅ idempotent      — duplicate insert guarded
//   ✅ deterministic   — sort by (position, id)
//   ✅ optimistic-aware — isOptimistic propagated

import type { ListCreatedEvent } from "@repo/domain";
import type { BoardStoreState }  from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext }   from "./context";

export function applyListCreated(
  state:    BoardStoreState,
  envelope: ClientEventEnvelope<ListCreatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;
  const { listId, title, position } = event.payload;

  const existingList = state.lists[listId];

  // ✅ Stale guard
  if (existingList && existingList.revision >= event.version) return {};

  const newList = {
    ...(existingList ?? {}),
    id:           listId,
    title,
    position,
    revision:     event.version,
    isOptimistic: envelope.optimistic ?? false,
  };

  // ✅ Idempotent insert
  const nextListOrder = state.listOrder.includes(listId)
    ? [...state.listOrder]
    : [...state.listOrder, listId];

  // ✅ Deterministic stable sort
  nextListOrder.sort((a, b) => {
    const posA = a === listId ? newList.position : (state.lists[a]?.position ?? "");
    const posB = b === listId ? newList.position : (state.lists[b]?.position ?? "");
    return posA.localeCompare(posB) || a.localeCompare(b);
  });

  return {
    lists:       { ...state.lists, [listId]: newList },
    listOrder:   nextListOrder,
    // ✅ Initialise empty card bucket if not already present
    cardsByList: { ...state.cardsByList, [listId]: state.cardsByList[listId] ?? [] },
  };
}
