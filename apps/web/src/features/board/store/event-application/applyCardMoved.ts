// apps/web/src/features/board/store/event-application/applyCardMoved.ts

import type { CardMovedEvent } from "@repo/domain";

import type { BoardStoreState, CardDto } from "../useBoardStore";

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
 * - move card between lists (or within same list)
 * - update LexoRank position
 * - propagate boardId from payload (defensive: payload is source of truth)
 * - maintain deterministic ordering
 * - stay replay-safe
 * - stay immutable
 *
 * Rules:
 * ✅ Pure
 * ✅ No side-effects
 * ✅ Replay-safe
 * ✅ Stale-protected (existingCard.revision >= event.version → drop)
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

  // 🌟 Full canonical payload — boardId is the source of truth
  const {
    cardId,
    boardId,
    fromListId,
    toListId,
    newPosition,
  } = event.payload;

  /**
   * --------------------------------------------------------------
   * Replay Safety Guard
   * --------------------------------------------------------------
   * Card may not exist (deleted/replay-incomplete). Reducer must
   * never throw — silently drop.
   * --------------------------------------------------------------
   */
  const existingCard = state.cards[cardId];

  if (!existingCard) {
    return {};
  }

  /**
   * --------------------------------------------------------------
   * Stale Protection
   * --------------------------------------------------------------
   * If our existing card revision is already >= the event's version,
   * this event is stale (already applied or superseded). Drop it.
   * Note: event.version may be undefined in test fixtures — in that
   * case we let the event through (NaN comparison yields false).
   * --------------------------------------------------------------
   */
  if (existingCard.revision >= event.version) {
    return {};
  }

  /**
   * --------------------------------------------------------------
   * Build Updated Card (Immutable)
   * --------------------------------------------------------------
   * boardId is taken from payload (authoritative). If existingCard had
   * a stale or empty boardId, this self-heals.
   * Revision falls back to existing+1 if event.version is missing
   * (defensive — prevents undefined leaking into state).
   * --------------------------------------------------------------
   */
  const updatedCard: CardDto = {
    ...existingCard,
    boardId: boardId ?? existingCard.boardId,
    listId: toListId,
    position: newPosition,
    revision: event.version ?? existingCard.revision + 1,
    isOptimistic: envelope.acknowledged
      ? false
      : envelope.optimistic ?? existingCard.isOptimistic ?? false,
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
   * Insert Into Target List (idempotent)
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
   * MUST use updatedCard.position (not stale state). ID tie-break.
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
   * Build cardsByList output, handling same-list reorder edge case
   * --------------------------------------------------------------
   * If fromListId === toListId we must not write previousListCards
   * (which is empty after filter) and overwrite the toListId entry.
   * --------------------------------------------------------------
   */
  const nextCardsByList =
    fromListId === toListId
      ? {
          ...state.cardsByList,
          [toListId]: nextListCards,
        }
      : {
          ...state.cardsByList,
          [fromListId]: previousListCards,
          [toListId]: nextListCards,
        };

  return {
    cards: {
      ...state.cards,
      [cardId]: updatedCard,
    },
    cardsByList: nextCardsByList,
  };
}
