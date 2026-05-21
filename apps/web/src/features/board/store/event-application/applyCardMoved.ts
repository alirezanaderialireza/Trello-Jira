// apps/web/src/features/board/store/event-application/applyCardMoved.ts

import type { CardMovedEvent } from "@repo/domain";

import type { BoardStoreState } from "../useBoardStore";

import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

/**
 * ------------------------------------------------------------------
 * applyCardMoved
 * ------------------------------------------------------------------
 *
 * Pure Event Reducer
 *
 * Responsibilities:
 * - move card between lists
 * - update LexoRank position
 * - maintain deterministic ordering
 * - stay replay-safe
 * - stay immutable
 *
 * Rules:
 * ✅ Pure
 * ✅ No side-effects
 * ✅ Replay-safe
 * ✅ Deterministic
 * ✅ Partial state return
 * ------------------------------------------------------------------
 */

export function applyCardMoved(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<CardMovedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;

  const {
    cardId,
    fromListId,
    toListId,
    newPosition,
  } = event.payload;

  /**
   * --------------------------------------------------------------
   * Replay Safety Guard
   * --------------------------------------------------------------
   *
   * اگر کارت وجود ندارد:
   * - ممکن است event قدیمی باشد
   * - ممکن است کارت حذف شده باشد
   * - ممکن است replay ناقص باشد
   *
   * Reducer نباید crash کند.
   * --------------------------------------------------------------
   */
  const existingCard = state.cards[cardId];

  if (!existingCard) {
    return {};
  }

  // ✅ Stale guard: skip if current state is already at or ahead of this event
  if (existingCard.revision >= event.version) {
    return {};
  }

  /**
   * --------------------------------------------------------------
   * Build Updated Card
   * --------------------------------------------------------------
   *
   * Immutable entity update.
   * --------------------------------------------------------------
   */
  const updatedCard = {
    ...existingCard,
    listId:      toListId,
    position:    newPosition,
    // ✅ event.version is typed on DomainEvent base — no cast needed
    revision:    event.version,
    isOptimistic: envelope.optimistic ?? existingCard.isOptimistic ?? false,
  };

  /**
   * --------------------------------------------------------------
   * Remove Card From Previous List
   * --------------------------------------------------------------
   */
  const previousListCards =
    state.cardsByList[fromListId]?.filter((id: string) => id !== cardId) ?? [];

  /**
   * --------------------------------------------------------------
   * Insert Into Target List
   * --------------------------------------------------------------
   *
   * Important:
   * We insert first, then perform deterministic sorting.
   * --------------------------------------------------------------
   */
  const nextListCards = [
    ...(state.cardsByList[toListId] ?? []).filter(
      (id: string) => id !== cardId,
    ),

    cardId,
  ];

  /**
   * --------------------------------------------------------------
   * Deterministic Stable Sort
   * --------------------------------------------------------------
   *
   * Extremely important.
   *
   * We MUST use updatedCard.position
   * instead of stale state.cards[cardId].position.
   *
   * Otherwise:
   * - optimistic reorder bugs happen
   * - replay divergence happens
   * - websocket reconciliation breaks
   *
   * Fallback to ID guarantees stable ordering.
   * --------------------------------------------------------------
   */
  nextListCards.sort((a, b) => {
    const posA =
      a === cardId
        ? updatedCard.position
        : state.cards[a]?.position ?? "";

    const posB =
      b === cardId
        ? updatedCard.position
        : state.cards[b]?.position ?? "";

    return posA.localeCompare(posB) || a.localeCompare(b);
  });

  /**
   * --------------------------------------------------------------
   * Partial Immutable State Return
   * --------------------------------------------------------------
   *
   * Only changed slices are returned.
   * Zustand merge layer handles composition.
   * --------------------------------------------------------------
   */
  return {
    cards: {
      ...state.cards,

      [cardId]: updatedCard,
    },

    cardsByList: {
      ...state.cardsByList,

      [fromListId]: previousListCards,

      [toListId]: nextListCards,
    },
  };
}