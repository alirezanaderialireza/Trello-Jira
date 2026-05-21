// apps/web/src/features/board/store/event-application/applyCardCreated.ts
//
// Phase-0 audit:
//   ✅ stale-safe      — if card already exists with higher revision → {}
//   ✅ idempotent      — duplicate insert guarded, sort is stable
//   ✅ deterministic   — sort by (position, id)
//   ✅ optimistic-aware — isOptimistic propagated
//   ✅ boardId required — read from payload (was missing before)

import type { CardCreatedEvent } from "@repo/domain";
import type { BoardStoreState }  from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext }   from "./context";

export function applyCardCreated(
  state:    BoardStoreState,
  envelope: ClientEventEnvelope<CardCreatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;
  const { cardId, listId, boardId, title, position } = event.payload;

  const existingCard = state.cards[cardId];

  // ✅ Stale guard: if we already have a newer revision, skip
  if (existingCard && existingCard.revision >= event.version) return {};

  const newCard = {
    ...(existingCard ?? {}),
    id:           cardId,
    boardId,
    listId,
    title,
    position,
    revision:     event.version,
    isOptimistic: envelope.optimistic ?? false,
  };

  const currentBucket = state.cardsByList[listId] ?? [];

  // ✅ Idempotent insert
  const nextBucket = currentBucket.includes(cardId)
    ? [...currentBucket]
    : [...currentBucket, cardId];

  // ✅ Deterministic stable sort
  nextBucket.sort((a, b) => {
    const posA = a === cardId ? newCard.position : (state.cards[a]?.position ?? "");
    const posB = b === cardId ? newCard.position : (state.cards[b]?.position ?? "");
    return posA.localeCompare(posB) || a.localeCompare(b);
  });

  return {
    cards:       { ...state.cards,       [cardId]: newCard },
    cardsByList: { ...state.cardsByList, [listId]: nextBucket },
  };
}
