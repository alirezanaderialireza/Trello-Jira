// apps/web/src/features/board/store/event-application/applyCardDeleted.ts

import type { CardDeletedEvent } from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

/**
 * ------------------------------------------------------------------
 * applyCardDeleted
 * ------------------------------------------------------------------
 * Responsibilities:
 * - Deterministic card removal from cards dict
 * - O(1) targeted cardsByList update
 * - Stale event protection (>= version check)
 * - Idempotency (safe against double deletion)
 * ------------------------------------------------------------------
 */
export function applyCardDeleted(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<CardDeletedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;

  // 🌟 Note: we only need cardId for delete; boardId is in payload but
  // unused here (no DTO to construct). Tenant guards happen on server.
  const { cardId } = event.payload;

  const existingCard = state.cards[cardId];

  /**
   * 🛡️ Idempotency & Stale Guard
   * - Card already removed? Skip.
   * - Already at revision >= event.version (recreate scenario)? Skip.
   */
  if (!existingCard || existingCard.revision >= event.version) {
    return {};
  }

  const sourceListId = existingCard.listId;

  /**
   * 🛡️ Referential Integrity Check
   * If card was already moved to another list (race with move event),
   * we still remove it from cards dict but skip cardsByList rewrite.
   */
  const currentListIds = state.cardsByList[sourceListId] ?? [];
  const isCardInList = currentListIds.includes(cardId);

  // Remove card from main dictionary
  const { [cardId]: _removedCard, ...remainingCards } = state.cards;

  if (!isCardInList) {
    return {
      cards: remainingCards,
    };
  }

  /**
   * 🚀 O(1) Targeted Update
   */
  return {
    cards: remainingCards,
    cardsByList: {
      ...state.cardsByList,
      [sourceListId]: currentListIds.filter((id: string) => id !== cardId),
    },
  };
}
