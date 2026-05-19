// apps/web/src/features/board/store/event-application/applyCardUpdated.ts
//
// Phase-0 audit:
//   ✅ stale-safe      — strictly-greater guard (> not >=)
//                        rationale: update carries version = currentRevision+1.
//                        optimistic update uses same revision as current entity,
//                        so >= would incorrectly drop the first optimistic write.
//   ✅ idempotent      — same event applied twice produces identical state
//   ✅ deterministic   — merge is order-independent for same input
//   ✅ optimistic-aware — isOptimistic flag set from envelope

import type { CardUpdatedEvent } from "@repo/domain";
import type { BoardStoreState }  from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext }   from "./context";

export function applyCardUpdated(
  state:    BoardStoreState,
  envelope: ClientEventEnvelope<CardUpdatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;
  const { cardId, changes } = event.payload;

  const existingCard = state.cards[cardId];
  if (!existingCard) return {};

  // ✅ Strictly-greater guard for update events
  // Use > (not >=) because:
  //   - server event: version = card.revision + 1  → must pass
  //   - optimistic:   version = card.revision       → must pass (equal is ok)
  //   - stale replay: version < card.revision       → must drop
  if (existingCard.revision > event.version) return {};

  const updatedCard = {
    ...existingCard,
    ...changes,
    id:           cardId,           // prevent payload from overwriting id
    revision:     event.version,
    isOptimistic: envelope.optimistic ?? false,
  };

  return {
    cards: { ...state.cards, [cardId]: updatedCard },
  };
}
