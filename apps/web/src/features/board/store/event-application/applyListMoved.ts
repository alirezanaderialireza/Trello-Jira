// apps/web/src/features/board/store/event-application/applyListMoved.ts

import type { ListMovedEvent } from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
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
 * - move / reorder lists on the board
 * - update LexoRank position
 * - maintain deterministic board ordering
 * - preserve replay safety
 * - support optimistic reconciliation
 *
 * Rules:
 * ✅ Pure
 * ✅ Immutable
 * ✅ Replay-safe
 * ✅ Idempotent
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

  const { listId, newPosition } = event.payload;

  // -------------------------------------------------------------------------
  // Replay Safety Guard
  // -------------------------------------------------------------------------
  const existingList = state.lists[listId];
  if (!existingList) {
    return {};
  }

  // -------------------------------------------------------------------------
  // Build Updated List Entity
  // -------------------------------------------------------------------------
  // R7 fix: use event.version directly — DomainEvent<T,P>.version is always
  // number.  The previous (event as any).version hack hid a TS typing error
  // caused by an old eventVersion alias that no longer exists in base.ts.
  // -------------------------------------------------------------------------
  const updatedList = {
    ...existingList,
    position: newPosition,
    revision: event.version,   // ← was: (event as any).version — now type-safe
    isOptimistic: envelope.optimistic ?? existingList.isOptimistic ?? false,
  };

  // -------------------------------------------------------------------------
  // Deterministic Stable Sort of listOrder
  // -------------------------------------------------------------------------
  // MUST use updatedList.position for the moved list (not the stale value in
  // state.lists[listId].position).  Failure causes ordering divergence across
  // clients during optimistic reorder and replay.
  // -------------------------------------------------------------------------
  const nextListOrder = [...state.listOrder];

  nextListOrder.sort((a, b) => {
    const posA =
      a === listId ? updatedList.position : (state.lists[a]?.position ?? "");
    const posB =
      b === listId ? updatedList.position : (state.lists[b]?.position ?? "");

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
