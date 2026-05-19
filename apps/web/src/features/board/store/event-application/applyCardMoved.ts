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
 * - move card between lists (or reorder within the same list)
 * - update LexoRank position
 * - maintain deterministic ordering
 * - stay replay-safe
 * - stay immutable
 *
 * Rules:
 * ✅ Pure
 * ✅ No side-effects
 * ✅ Replay-safe
 * ✅ Idempotent
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

  const { cardId, fromListId, toListId, newPosition } = event.payload;

  // -------------------------------------------------------------------------
  // Replay Safety Guard
  // -------------------------------------------------------------------------
  // If the card no longer exists the event is either stale, arrives after a
  // concurrent delete, or is part of an incomplete replay.  Never crash.
  // -------------------------------------------------------------------------
  const existingCard = state.cards[cardId];
  if (!existingCard) {
    return {};
  }

  // -------------------------------------------------------------------------
  // Build Updated Card
  // -------------------------------------------------------------------------
  // R6 fix: use event.version directly — DomainEvent<T,P> always has version:
  // number.  The previous (event as any).version hack masked a typing error.
  // -------------------------------------------------------------------------
  const updatedCard = {
    ...existingCard,
    listId: toListId,
    position: newPosition,
    revision: event.version,   // ← was: (event as any).version — now type-safe
    isOptimistic: envelope.optimistic ?? existingCard.isOptimistic ?? false,
  };

  // -------------------------------------------------------------------------
  // Remove Card From Source List
  // -------------------------------------------------------------------------
  const previousListCards =
    state.cardsByList[fromListId]?.filter((id) => id !== cardId) ?? [];

  // -------------------------------------------------------------------------
  // Build Target List (idempotent insert)
  // -------------------------------------------------------------------------
  const nextListCards = [
    ...(state.cardsByList[toListId] ?? []).filter((id) => id !== cardId),
    cardId,
  ];

  // -------------------------------------------------------------------------
  // Deterministic Stable Sort
  // -------------------------------------------------------------------------
  // MUST use updatedCard.position for the moved card, not the stale value
  // still held in state.cards[cardId].position.  Failure here causes:
  //   - optimistic reorder bugs
  //   - replay divergence
  //   - multi-client ordering inconsistency
  // -------------------------------------------------------------------------
  nextListCards.sort((a, b) => {
    const posA =
      a === cardId ? updatedCard.position : (state.cards[a]?.position ?? "");
    const posB =
      b === cardId ? updatedCard.position : (state.cards[b]?.position ?? "");

    return posA.localeCompare(posB) || a.localeCompare(b);
  });

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
