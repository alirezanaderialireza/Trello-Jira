// apps/web/src/features/board/store/event-application/applyCardMoved.ts
//
// Phase-0 audit:
//   ✅ stale-safe      — existingCard.revision >= event.version → {}
//   ✅ idempotent      — running twice with same event returns same state
//   ✅ deterministic   — sort by (position, id) tie-breaker
//   ✅ optimistic-aware — isOptimistic flag propagated from envelope
//   ✅ null-safe       — missing card/list buckets handled gracefully

import type { CardMovedEvent } from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

export function applyCardMoved(
  state:    BoardStoreState,
  envelope: ClientEventEnvelope<CardMovedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;
  const { cardId, fromListId, toListId, newPosition } = event.payload;

  const existingCard = state.cards[cardId];

  // Replay-safety: card may have been deleted before this event arrived
  if (!existingCard) return {};

  // ✅ Stale guard — skip events that carry an older version than what we have
  if (existingCard.revision >= event.version) return {};

  const updatedCard = {
    ...existingCard,
    listId:      toListId,
    position:    newPosition,
    revision:    event.version,
    isOptimistic: envelope.optimistic ?? false,
  };

  // Remove from source list (idempotent: filter is safe even if already absent)
  const prevListCards = (state.cardsByList[fromListId] ?? []).filter(
    (id) => id !== cardId,
  );

  // Insert into target list, dedup first (idempotent re-application)
  const baseTargetCards = (state.cardsByList[toListId] ?? []).filter(
    (id) => id !== cardId,
  );
  const nextTargetCards = [...baseTargetCards, cardId];

  // Deterministic stable sort: position ASC, then id ASC as tie-breaker
  nextTargetCards.sort((a, b) => {
    const posA = a === cardId ? updatedCard.position : (state.cards[a]?.position ?? "");
    const posB = b === cardId ? updatedCard.position : (state.cards[b]?.position ?? "");
    return posA.localeCompare(posB) || a.localeCompare(b);
  });

  return {
    cards: { ...state.cards, [cardId]: updatedCard },
    cardsByList: {
      ...state.cardsByList,
      [fromListId]: prevListCards,
      [toListId]:   nextTargetCards,
    },
  };
}
