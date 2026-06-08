// apps/web/src/features/board/store/event-application/applyCardCoverUpdated.ts
//
// Phase 1.2 (F1.2.7) — reducer for card.cover_updated events.
// Mirrors applyCardDueDateUpdated exactly.

import type { CardCoverUpdatedEvent } from "@repo/domain";
import type { BoardStoreState }       from "../useBoardStore";
import type { ClientEventEnvelope }   from "./types";
import type { ReducerContext }         from "./context";

export function applyCardCoverUpdated(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<CardCoverUpdatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { cardId, newCover } = envelope.event.payload;
  const existing = state.cards[cardId];
  if (!existing) return {};
  if (existing.revision >= envelope.event.version) return {};

  return {
    cards: {
      ...state.cards,
      [cardId]: {
        ...existing,
        coverData:    newCover,
        revision:     envelope.event.version,
        isOptimistic: envelope.optimistic ?? false,
      },
    },
  };
}
