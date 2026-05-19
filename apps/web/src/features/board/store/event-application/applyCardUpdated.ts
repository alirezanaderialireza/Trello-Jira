// apps/web/src/features/board/store/event-application/applyCardUpdated.ts

import type { CardUpdatedEvent } from "@repo/domain";
import type { BoardStoreState, CardDto } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

/**
 * ------------------------------------------------------------------
 * applyCardUpdated
 * ------------------------------------------------------------------
 * Responsibilities:
 * - apply title/description changes from payload
 * - propagate boardId from payload (defensive self-healing)
 * - stale protection via version check
 * ------------------------------------------------------------------
 */
export function applyCardUpdated(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<CardUpdatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;

  // 🌟 Full canonical payload destructure
  const { cardId, boardId, changes } = event.payload;

  const existingCard = state.cards[cardId];

  if (!existingCard) {
    return {};
  }

  /**
   * 🛡️ Stale Protection — dual-revision aware
   *
   * For server events: compare against confirmedRevision (canonical).
   * For optimistic events: compare against revision (local optimistic).
   * Without this distinction, an ACK with version === optimistic-revision
   * would be wrongly dropped, leaving the client diverged from the server.
   */
  if (envelope.acknowledged) {
    if (existingCard.confirmedRevision >= event.version) {
      return {};
    }
  } else {
    if (existingCard.revision >= event.version) {
      return {};
    }
  }

  // 🌟 boardId from payload is authoritative; if missing (e.g. legacy/test
  // fixtures), fall back to the existing entity's boardId.
  const updatedCard: CardDto = {
    ...existingCard,
    boardId: boardId ?? existingCard.boardId,
    ...(changes.title !== undefined && { title: changes.title }),
    ...(changes.description !== undefined && { description: changes.description }),
    revision: event.version,
    confirmedRevision: envelope.acknowledged
      ? event.version
      : existingCard.confirmedRevision,
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
