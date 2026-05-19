// apps/web/src/features/board/store/event-application/applyCardCreated.ts

import type { CardCreatedEvent } from "@repo/domain";
import type { BoardStoreState, CardDto } from "../useBoardStore";

import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

/**
 * ------------------------------------------------------------------
 * applyCardCreated
 * ------------------------------------------------------------------
 *
 * Pure Event Reducer
 *
 * Responsibilities:
 * - create card entity from canonical domain payload
 * - insert card into list ordering
 * - preserve replay safety
 * - support optimistic reconciliation
 * - maintain deterministic ordering
 *
 * Rules:
 * ✅ Pure
 * ✅ Immutable
 * ✅ Replay-safe
 * ✅ Idempotent
 * ✅ Deterministic sorting
 * ✅ Partial state return
 * ✅ Full payload field extraction (no field drift)
 * ------------------------------------------------------------------
 */

export function applyCardCreated(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<CardCreatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;

  // 🌟 Full canonical payload destructure — every required field must
  // map into the runtime DTO. Missing fields cause silent DTO corruption
  // (see PR #8 follow-up: boardId was being dropped here).
  const {
    cardId,
    boardId,
    listId,
    title,
    position,
  } = event.payload;

  /**
   * --------------------------------------------------------------
   * Existing Card Detection (Idempotency Gate)
   * --------------------------------------------------------------
   * Vital for:
   * - optimistic reconciliation (server reissues create after ACK)
   * - websocket replay (gap recovery)
   * - offline hydration
   *
   * If card already exists, we merge: existing local fields are preserved
   * but server payload is authoritative.
   * --------------------------------------------------------------
   */
  const existingCard = state.cards[cardId];

  /**
   * --------------------------------------------------------------
   * Build Canonical Card DTO
   * --------------------------------------------------------------
   * The DTO must be a complete CardDto. Every required field of
   * CardDto must come either from the payload or from the existing
   * entity (when merging). No `undefined` slips into state.
   * --------------------------------------------------------------
   */
  const newCard: CardDto = {
    ...(existingCard ?? {}),
    id: cardId,
    boardId: boardId ?? existingCard?.boardId ?? "",
    listId,
    title,
    position,
    revision: event.version,
    isOptimistic: envelope.acknowledged
      ? false
      : envelope.optimistic ?? existingCard?.isOptimistic ?? false,
  };

  /**
   * --------------------------------------------------------------
   * Idempotent Insert into Target List
   * --------------------------------------------------------------
   */
  const currentListCards = state.cardsByList[listId] ?? [];
  const nextListCards = currentListCards.includes(cardId)
    ? [...currentListCards]
    : [...currentListCards, cardId];

  /**
   * --------------------------------------------------------------
   * Deterministic Stable Sort
   * --------------------------------------------------------------
   * Use newCard.position for the inserted entity (not stale state).
   * ID fallback ensures total ordering across all clients.
   * --------------------------------------------------------------
   */
  nextListCards.sort((a, b) => {
    const posA =
      a === cardId
        ? newCard.position
        : state.cards[a]?.position ?? "";

    const posB =
      b === cardId
        ? newCard.position
        : state.cards[b]?.position ?? "";

    return posA.localeCompare(posB) || a.localeCompare(b);
  });

  return {
    cards: {
      ...state.cards,
      [cardId]: newCard,
    },
    cardsByList: {
      ...state.cardsByList,
      [listId]: nextListCards,
    },
  };
}
