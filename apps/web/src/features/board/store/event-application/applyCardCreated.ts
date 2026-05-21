// apps/web/src/features/board/store/event-application/applyCardCreated.ts

import type { CardCreatedEvent } from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

/**
 * applyCardCreated — Pure Event Reducer
 *
 * Fixes applied:
 * ✅ boardId is now read from event.payload (CardCreatedPayload.boardId is required)
 * ✅ revision uses event.version directly — no unsafe (event as any) cast needed
 *    because ClientEventEnvelope<CardCreatedEvent> gives us full type safety.
 *
 * Rules:
 * - Pure, immutable, replay-safe, idempotent, deterministic sort
 */
export function applyCardCreated(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<CardCreatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;
  const { cardId, listId, boardId, title, position } = event.payload;

  // ------------------------------------------------------------------
  // Idempotency: merge with existing card if already present
  // (handles optimistic→server reconciliation, replay, offline hydration)
  // ------------------------------------------------------------------
  const existingCard = state.cards[cardId] ?? {};

  const newCard = {
    ...existingCard,
    id: cardId,
    boardId,       // ✅ was missing — CardDto.boardId is required
    listId,
    title,
    position,
    revision: event.version,   // ✅ direct, no cast
    isOptimistic: envelope.optimistic ?? false,
  };

  // ------------------------------------------------------------------
  // Idempotent insert into list
  // ------------------------------------------------------------------
  const currentListCards = state.cardsByList[listId] ?? [];
  const nextListCards = currentListCards.includes(cardId)
    ? [...currentListCards]
    : [...currentListCards, cardId];

  // ------------------------------------------------------------------
  // Deterministic stable sort (use newCard.position, not stale state)
  // ------------------------------------------------------------------
  nextListCards.sort((a, b) => {
    const posA = a === cardId ? newCard.position : (state.cards[a]?.position ?? "");
    const posB = b === cardId ? newCard.position : (state.cards[b]?.position ?? "");
    return posA.localeCompare(posB) || a.localeCompare(b);
  });

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
