// apps/web/src/features/board/store/event-application/applyCardCreated.ts

// 🌟 (Fix 1): ایمپورت مستقیماً از ریشه دامین انجام می‌شود
import type { CardCreatedEvent } from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";

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
 * - create card entity
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
 * ------------------------------------------------------------------
 */

export function applyCardCreated(
  state: BoardStoreState, // 🌟 به BoardStoreState که در فایل استور تو وجود دارد تغییر یافت
  envelope: ClientEventEnvelope<CardCreatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;

  // boardId comes through the payload too — must be carried into newCard
  // so the store entity satisfies CardDto (which has `boardId: string`
  // as a required field). Without it the production type-check fails:
  //   Property 'boardId' is missing in type
  //     '{ id; listId; title; position; revision; isOptimistic }'
  //   but required in type 'CardDto'.
  const {
    cardId,
    boardId,
    listId,
    title,
    position,
  } = event.payload;

  /**
   * --------------------------------------------------------------
   * Existing Card Detection
   * --------------------------------------------------------------
   *
   * Extremely important for:
   * - optimistic reconciliation
   * - websocket replay
   * - offline hydration
   * - idempotency
   *
   * If card already exists:
   * preserve local fields and merge authoritative server data.
   * --------------------------------------------------------------
   */
  const existingCard = state.cards[cardId] ?? {};

  /**
   * --------------------------------------------------------------
   * Build Card Entity
   * --------------------------------------------------------------
   *
   * Immutable merge.
   * Server becomes source of truth.
   * --------------------------------------------------------------
   */
  const newCard = {
    ...existingCard,

    id: cardId,

    boardId,
    listId,
    title,
    position,

    revision: event.version ?? 0,

    /**
     * Runtime-only metadata
     */
    isOptimistic: envelope.optimistic ?? false,
  };

  /**
   * --------------------------------------------------------------
   * Current List Snapshot
   * --------------------------------------------------------------
   */
  const currentListCards = state.cardsByList[listId] ?? [];

  /**
   * --------------------------------------------------------------
   * Idempotent Insert
   * --------------------------------------------------------------
   *
   * Prevent duplicate insertion during:
   * - websocket replay
   * - offline replay
   * - hydration
   * - optimistic/server reconciliation
   * --------------------------------------------------------------
   */
  const nextListCards = currentListCards.includes(cardId)
    ? [...currentListCards]
    : [...currentListCards, cardId];

  /**
   * --------------------------------------------------------------
   * Deterministic Stable Sort
   * --------------------------------------------------------------
   *
   * Important:
   * Use newCard.position for the newly inserted entity.
   * Never trust stale state during reducer execution.
   * Fallback to ID guarantees total ordering stability.
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

  /**
   * --------------------------------------------------------------
   * Partial Immutable State Return
   * --------------------------------------------------------------
   */
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