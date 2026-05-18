// apps/web/src/features/board/store/event-application/applyListMoved.ts

// 🌟 (Fix 1): ایمپورت مستقیم از ریشه دامین
import type { ListMovedEvent } from "@repo/domain";

// 🌟 (Fix 2): استفاده از BoardState به جای BoardStoreState
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
 * - move/reorder lists
 * - update LexoRank position
 * - maintain deterministic board ordering
 * - preserve replay safety
 * - support optimistic reconciliation
 *
 * Rules:
 * ✅ Pure
 * ✅ Immutable
 * ✅ Replay-safe
 * ✅ Deterministic
 * ✅ Partial state return
 * ✅ Stable sorting
 * ------------------------------------------------------------------
 */

export function applyListMoved(
  state: BoardStoreState, // 🌟 تغییر به BoardState
  envelope: ClientEventEnvelope<ListMovedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> { // 🌟 تغییر به BoardState
  const { event } = envelope;

  const {
    listId,
    newPosition,
  } = event.payload;

  /**
   * --------------------------------------------------------------
   * Replay Safety Guard
   * --------------------------------------------------------------
   *
   * Reducers must never throw during:
   * - websocket replay
   * - offline recovery
   * - hydration
   * - partial synchronization
   *
   * Missing entities are ignored safely.
   * --------------------------------------------------------------
   */
  const existingList = state.lists[listId];

  if (!existingList) {
    return {};
  }

  /**
   * --------------------------------------------------------------
   * Immutable List Update
   * --------------------------------------------------------------
   */
  const updatedList = {
    ...existingList,

    position: newPosition,

    // 🌟 (Fix 3): جلوگیری از ارور تایپ مربوط به فیلد ورژن
    revision: (event as any).version || (event as any).eventVersion || 0,

    /**
     * Runtime-only metadata
     */
    isOptimistic:
      envelope.optimistic ??
      existingList.isOptimistic ??
      false,
  };

  /**
   * --------------------------------------------------------------
   * Snapshot Current Ordering
   * --------------------------------------------------------------
   *
   * We clone to preserve immutability.
   * --------------------------------------------------------------
   */
  const nextListOrder = [...state.listOrder];

  /**
   * --------------------------------------------------------------
   * Deterministic Stable Sort
   * --------------------------------------------------------------
   *
   * Critical:
   * use updatedList.position instead of stale state.
   *
   * Guarantees:
   * - replay consistency
   * - websocket consistency
   * - offline deterministic recovery
   * - stable hydration
   *
   * Fallback to ID ensures total ordering stability.
   * --------------------------------------------------------------
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

  /**
   * --------------------------------------------------------------
   * Partial Immutable State Return
   * --------------------------------------------------------------
   */
  return {
    lists: {
      ...state.lists,

      [listId]: updatedList,
    },

    listOrder: nextListOrder,
  };
}