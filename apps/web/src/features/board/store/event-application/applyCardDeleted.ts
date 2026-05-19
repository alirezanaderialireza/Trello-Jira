// apps/web/src/features/board/store/event-application/applyCardDeleted.ts
//
// Phase-0 audit:
//   ✅ stale-safe      — strictly-greater guard (>) 
//                        delete event carries version = card.revision + 1.
//                        If card is already at a higher revision (recreated),
//                        drop the delete. If equal (normal case), proceed.
//   ✅ idempotent      — card already absent → {} (no-op)
//   ✅ deterministic   — pure filter, no randomness
//   ✅ optimistic-aware — optimistic deletes allowed

import type { CardDeletedEvent } from "@repo/domain";
import type { BoardStoreState }  from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext }   from "./context";

export function applyCardDeleted(
  state:    BoardStoreState,
  envelope: ClientEventEnvelope<CardDeletedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;
  const { cardId } = event.payload;

  const existingCard = state.cards[cardId];

  // ✅ Idempotency: already gone
  if (!existingCard) return {};

  // ✅ Stale guard with strictly-greater: only skip if current > event version
  // (meaning the card was re-created with a higher revision after this delete
  //  was originally issued — rare but valid in distributed systems)
  if (existingCard.revision > event.version) return {};

  const sourceListId       = existingCard.listId;
  const currentListCards   = state.cardsByList[sourceListId] ?? [];

  const { [cardId]: _removed, ...remainingCards } = state.cards;

  // ✅ Referential integrity: only update the bucket if card is actually there
  if (!currentListCards.includes(cardId)) {
    return { cards: remainingCards };
  }

  return {
    cards:       remainingCards,
    cardsByList: {
      ...state.cardsByList,
      [sourceListId]: currentListCards.filter((id) => id !== cardId),
    },
  };
}
