// apps/web/src/features/board/store/event-application/applyListUpdated.ts
//
// Phase-0 audit:
//   ✅ stale-safe      — strictly-greater guard (same rationale as applyCardUpdated)
//   ✅ idempotent      — same event twice → same result
//   ✅ deterministic   — merge is field-by-field, no randomness
//   ✅ optimistic-aware — isOptimistic propagated

import type { ListUpdatedEvent } from "@repo/domain";
import type { BoardStoreState }  from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext }   from "./context";

export function applyListUpdated(
  state:    BoardStoreState,
  envelope: ClientEventEnvelope<ListUpdatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;
  const { listId, changes } = event.payload;

  const existingList = state.lists[listId];
  if (!existingList) return {};

  // ✅ Strictly-greater guard (same reasoning as applyCardUpdated)
  if (existingList.revision > event.version) return {};

  const updatedList = {
    ...existingList,
    ...changes,
    id:           listId,           // prevent payload overwriting id
    revision:     event.version,
    isOptimistic: envelope.optimistic ?? false,
  };

  return {
    lists: { ...state.lists, [listId]: updatedList },
  };
}
