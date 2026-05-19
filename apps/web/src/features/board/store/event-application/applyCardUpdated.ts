import type { CardUpdatedEvent } from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

export function applyCardUpdated(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<CardUpdatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;
  const { cardId, changes } = event.payload;

  const existingCard = state.cards[cardId];

  if (!existingCard) {
    return {};
  }

  // 🌟 Stale Protection Guard
  if (existingCard.revision >= event.version) {
    return {}; // نادیده گرفتن رویداد قدیمی
  }

  const updatedCard = {
    ...existingCard,
    ...changes,
    revision: event.version,
    isOptimistic: envelope.acknowledged
      ? false
      : envelope.optimistic ?? existingCard.isOptimistic ?? false,
  };

  return {
    cards: {
      ...state.cards,
      [cardId]: updatedCard,
    },
  };
}