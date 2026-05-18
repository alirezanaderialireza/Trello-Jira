// apps/web/src/features/board/store/event-application/applyCardUpdated.ts

import type { CardUpdatedEvent } from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

/**
 * applyCardUpdated — Pure Event Reducer
 *
 * Fixes applied:
 * ✅ Stale guard direction corrected:
 *    OLD (wrong):  existingCard.revision >= event.version  → drops the first update ever
 *    NEW (correct): existingCard.revision > event.version   → only drops truly stale events
 *
 *    An update event carries version = card.revision + 1.
 *    The card sitting at revision N should accept event.version N+1 (N < N+1).
 *    With >= the condition N >= N+1 is false, so it worked accidentally in the
 *    simple case — BUT for optimistic events where version == current revision
 *    the guard would fire incorrectly and drop the optimistic update.
 *
 * Rules:
 * - Pure, immutable, replay-safe, idempotent
 */
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

  // ✅ strictly-greater guard: skip only if current state is newer
  if (existingCard.revision > event.version) {
    return {};
  }

  const updatedCard = {
    ...existingCard,
    ...changes,
    revision: event.version,
    isOptimistic: envelope.optimistic ?? false,
  };

  return {
    cards: {
      ...state.cards,
      [cardId]: updatedCard,
    },
  };
}
