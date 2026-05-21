// apps/web/src/features/board/store/event-application/applyListDeleted.ts
//
// Phase-0 audit:
//   ✅ stale-safe      — strictly-greater guard
//   ✅ idempotent      — list already absent → {} (no-op)
//   ✅ deterministic   — pure filter and object spread
//   ✅ optimistic-aware — optimistic deletes allowed
//
// Cascades: removes all orphaned cards that belonged to the list.

import type { ListDeletedEvent } from "@repo/domain";
import type { BoardStoreState }  from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext }   from "./context";

export function applyListDeleted(
  state:    BoardStoreState,
  envelope: ClientEventEnvelope<ListDeletedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;
  const { listId } = event.payload;

  const existingList = state.lists[listId];

  // ✅ Idempotency: already gone
  if (!existingList) return {};

  // ✅ Stale guard
  if (existingList.revision > event.version) return {};

  // Collect orphaned card ids so we can remove them from the cards map
  const orphanedCardIds = new Set(state.cardsByList[listId] ?? []);

  const { [listId]: _removedList,   ...remainingLists }       = state.lists;
  const { [listId]: _removedBucket, ...remainingCardsByList } = state.cardsByList;

  // ✅ Cascade: purge orphaned cards
  const remainingCards: typeof state.cards = {};
  for (const [id, card] of Object.entries(state.cards)) {
    if (!orphanedCardIds.has(id)) {
      remainingCards[id] = card;
    }
  }

  return {
    lists:       remainingLists,
    listOrder:   state.listOrder.filter((id) => id !== listId),
    cardsByList: remainingCardsByList,
    cards:       remainingCards,
  };
}
