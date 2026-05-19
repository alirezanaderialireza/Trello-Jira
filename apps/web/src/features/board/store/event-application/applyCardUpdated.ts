// apps/web/src/features/board/store/event-application/applyCardUpdated.ts

import type { CardUpdatedEvent } from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

/**
 * ------------------------------------------------------------------
 * applyCardUpdated
 * ------------------------------------------------------------------
 *
 * Pure Event Reducer
 *
 * Responsibilities:
 * - apply title / description changes to an existing card
 * - enforce stale-event protection
 * - preserve replay safety and idempotency
 *
 * Rules:
 * ✅ Pure
 * ✅ Immutable
 * ✅ Replay-safe
 * ✅ Idempotent
 * ✅ Partial state return
 * ------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // R8 fix — Stale Protection Guard: strict > instead of >=
  //
  // Previous policy: existingCard.revision >= event.version
  //   → DROP the event if card.revision equals event.version
  //
  // Problem: for a brand-new optimistic card (revision = 1) the first
  // server-confirmed update also carries version = 1.  With >= that
  // legitimate update was silently dropped, leaving the card perpetually
  // in its optimistic state.
  //
  // Correct policy: drop only when the current entity is STRICTLY AHEAD of
  // the incoming event (i.e. a newer event has already been applied).
  // This mirrors the same fix already applied to applyCardDeleted (B6).
  // -------------------------------------------------------------------------
  if (existingCard.revision > event.version) {
    return {};
  }

  // -------------------------------------------------------------------------
  // CardUpdatedPayload.changes is narrowly typed as { title?, description? }.
  // Spread only what the domain contract allows — do NOT spread arbitrary
  // Partial<CardDto> fields (id, listId, position, boardId, etc.) here.
  // Those identity fields are managed by dedicated events (card.created,
  // card.moved) and by replaceCard (which directly writes the canonical entry).
  // -------------------------------------------------------------------------
  const updatedCard = {
    ...existingCard,
    ...(changes.title !== undefined && { title: changes.title }),
    ...(changes.description !== undefined && { description: changes.description }),
    revision: event.version,
    isOptimistic: envelope.optimistic ?? existingCard.isOptimistic ?? false,
  };

  return {
    cards: {
      ...state.cards,
      [cardId]: updatedCard,
    },
  };
}
