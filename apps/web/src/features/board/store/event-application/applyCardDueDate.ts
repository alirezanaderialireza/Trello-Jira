// apps/web/src/features/board/store/event-application/applyCardDueDate.ts
//
// Phase 1.2 (F1.2.2) — adapted to event payload v2.
//
//   v1 (pre-F1.2.2 stub): payload.dueDate (ISO-8601 datetime)
//   v2 (this version):    payload.newDueDate (YYYY-MM-DD DateOnly)
//                          + payload.oldDueDate
//                          + payload.updatedBy
//
// The reducer reads `newDueDate` (the post-mutation value) and writes
// it onto the card's `dueDate` field. `oldDueDate` is informational
// only — used by the activity timeline projection (F1.2.6) but not by
// the board store. `updatedBy` is similarly informational.
//
// Idempotency
//   The standard guard `existing.revision >= envelope.event.version`
//   protects against a stale realtime patch overwriting a newer state.
//   Same pattern as every other reducer in this folder.

import type { CardDueDateUpdatedEvent } from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

export function applyCardDueDateUpdated(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<CardDueDateUpdatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { cardId, newDueDate } = envelope.event.payload;
  const existing = state.cards[cardId];
  if (!existing) return {};
  if (existing.revision >= envelope.event.version) return {};

  return {
    cards: {
      ...state.cards,
      [cardId]: {
        ...existing,
        dueDate:      newDueDate,
        revision:     envelope.event.version,
        isOptimistic: envelope.optimistic ?? false,
      },
    },
  };
}
