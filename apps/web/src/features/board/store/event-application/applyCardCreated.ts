// apps/web/src/features/board/store/event-application/applyCardCreated.ts

import type { CardCreatedEvent } from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

/**
 * ------------------------------------------------------------------
 * applyCardCreated
 * ------------------------------------------------------------------
 *
 * Pure Event Reducer
 *
 * Responsibilities:
 * - create card entity (including boardId)
 * - insert card into list ordering
 * - preserve replay safety
 * - support optimistic reconciliation
 * - maintain deterministic ordering
 *
 * Rules:
 * ✅ Pure
 * ✅ Immutable
 * ✅ Replay-safe
 * ✅ Idempotent
 * ✅ Deterministic sorting
 * ✅ Partial state return
 * ------------------------------------------------------------------
 */

export function applyCardCreated(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<CardCreatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;

  const { cardId, listId, boardId, title, position } = event.payload;

  /**
   * --------------------------------------------------------------
   * Existing Card Detection (Idempotency / Optimistic Reconciliation)
   * --------------------------------------------------------------
   *
   * If card already exists preserve local fields and merge
   * authoritative server data.
   * --------------------------------------------------------------
   */
  const existingCard = state.cards[cardId] ?? {};

  /**
   * --------------------------------------------------------------
   * Build Card Entity
   * --------------------------------------------------------------
   *
   * FIX B3: boardId is now read from payload and written to entity.
   * CardDto.boardId is required — never leave it undefined here.
   * --------------------------------------------------------------
   */
  const newCard = {
    ...existingCard,
    id: cardId,
    boardId,       // ← FIX B3: was missing before
    listId,
    title,
    position,
    revision: event.version,
    isOptimistic: envelope.optimistic ?? false,
  };

  /**
   * --------------------------------------------------------------
   * Current List Snapshot
   * --------------------------------------------------------------
   */
  const currentListCards = state.cardsByList[listId] ?? [];

  /**
   * --------------------------------------------------------------
   * Idempotent Insert
   * --------------------------------------------------------------
   *
   * Prevent duplicate insertion during:
   * - websocket replay
   * - offline replay
   * - hydration
   * - optimistic/server reconciliation
   * --------------------------------------------------------------
   */
  const nextListCards = currentListCards.includes(cardId)
    ? [...currentListCards]
    : [...currentListCards, cardId];

  /**
   * --------------------------------------------------------------
   * Deterministic Stable Sort
   * --------------------------------------------------------------
   *
   * Use newCard.position for the newly inserted entity.
   * Never trust stale state during reducer execution.
   * Fallback to ID guarantees total ordering stability.
   * --------------------------------------------------------------
   */
  nextListCards.sort((a, b) => {
    const posA =
      a === cardId ? newCard.position : (state.cards[a]?.position ?? "");

    const posB =
      b === cardId ? newCard.position : (state.cards[b]?.position ?? "");

    return posA.localeCompare(posB) || a.localeCompare(b);
  });

  /**
   * --------------------------------------------------------------
   * Partial Immutable State Return
   * --------------------------------------------------------------
   */
  return {
    cards: {
      ...state.cards,
      [cardId]: newCard,
    },
    cardsByList: {
      ...state.cardsByList,
      [listId]: nextListCards,
    },
  };
}
