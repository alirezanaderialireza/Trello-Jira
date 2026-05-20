// apps/web/src/features/board/store/event-application/applyCardDueDate.ts
import type { CardDueDateUpdatedEvent } from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

export function applyCardDueDateUpdated(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<CardDueDateUpdatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { cardId, dueDate } = envelope.event.payload;
  const existing = state.cards[cardId];
  if (!existing) return {};
  if (existing.revision >= envelope.event.version) return {};

  return {
    cards: {
      ...state.cards,
      [cardId]: {
        ...existing,
        dueDate:     dueDate,
        revision:    envelope.event.version,
        isOptimistic: envelope.optimistic ?? false,
      },
    },
  };
}
