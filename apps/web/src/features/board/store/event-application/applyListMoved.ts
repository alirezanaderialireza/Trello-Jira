// apps/web/src/features/board/store/event-application/applyListMoved.ts
//
// Phase-0 audit:
//   ✅ stale-safe      — existingList.revision >= event.version → {}
//   ✅ idempotent      — same event applied twice → same result
//   ✅ deterministic   — sort by (position, id)
//   ✅ optimistic-aware — isOptimistic propagated

import type { ListMovedEvent }  from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext }  from "./context";

export function applyListMoved(
  state:    BoardStoreState,
  envelope: ClientEventEnvelope<ListMovedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;
  const { listId, newPosition } = event.payload;

  const existingList = state.lists[listId];
  if (!existingList) return {};

  // ✅ Stale guard
  if (existingList.revision >= event.version) return {};

  const updatedList = {
    ...existingList,
    position:     newPosition,
    revision:     event.version,
    isOptimistic: envelope.optimistic ?? false,
  };

  const nextListOrder = [...state.listOrder];

  // ✅ Deterministic stable sort
  nextListOrder.sort((a, b) => {
    const posA = a === listId ? updatedList.position : (state.lists[a]?.position ?? "");
    const posB = b === listId ? updatedList.position : (state.lists[b]?.position ?? "");
    return posA.localeCompare(posB) || a.localeCompare(b);
  });

  return {
    lists:     { ...state.lists, [listId]: updatedList },
    listOrder: nextListOrder,
  };
}
