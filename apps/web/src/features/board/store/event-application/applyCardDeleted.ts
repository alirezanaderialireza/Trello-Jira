// apps/web/src/features/board/store/event-application/applyCardDeleted.ts

import type { CardDeletedEvent } from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

/**
 * applyCardDeleted — Pure Event Reducer
 *
 * Fixes applied:
 * ✅ Stale guard direction corrected:
 *    OLD (wrong):  existingCard.revision >= event.version
 *    NEW (correct): existingCard.revision > event.version
 *
 *    Reasoning: a delete event always carries version = card.revision + 1.
 *    If we blocked on >=, a delete at version N would be dropped whenever the
 *    card already sits at revision N-1 (which is the normal case), making
 *    deletes silently no-op. We should only skip if the card has been
 *    superseded by a *newer* confirmed write (revision strictly greater).
 *
 * Rules:
 * - Pure, immutable, replay-safe, idempotent
 */
export function applyCardDeleted(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<CardDeletedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;
  const { cardId } = event.payload;

  const existingCard = state.cards[cardId];

  // ------------------------------------------------------------------
  // Idempotency: card already removed
  // ------------------------------------------------------------------
  if (!existingCard) {
    return {};
  }

  // ------------------------------------------------------------------
  // ✅ Stale guard (strictly greater — see fix note above)
  // Skip only if the card has been updated to a revision HIGHER than
  // what this delete event targets (e.g. a Recreate arrived later).
  // ------------------------------------------------------------------
  if (existingCard.revision > event.version) {
    return {};
  }

  const sourceListId = existingCard.listId;
  const currentListIds = state.cardsByList[sourceListId] ?? [];
  const isCardInList = currentListIds.includes(cardId);

  // Remove card from dictionary
  const { [cardId]: _removed, ...remainingCards } = state.cards;

  if (!isCardInList) {
    // Card was already moved out of this list — only clean up the dict
    return { cards: remainingCards };
  }

  return {
    cards: remainingCards,
    cardsByList: {
      ...state.cardsByList,
      [sourceListId]: currentListIds.filter((id: string) => id !== cardId),
    },
  };
}
