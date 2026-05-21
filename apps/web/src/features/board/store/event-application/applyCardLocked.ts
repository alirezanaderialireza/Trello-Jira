// apps/web/src/features/board/store/event-application/applyCardLocked.ts
import type { CardLockedEvent, CardUnlockedEvent } from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

// ─── Lock ────────────────────────────────────────────────────────────────────

export function applyCardLocked(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<CardLockedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { cardId } = envelope.event.payload;
  const existing = state.cards[cardId];
  if (!existing) return {};

  // Stale protection: if the card is already locked at a higher revision, skip.
  if (existing.revision >= envelope.event.version) return {};

  return {
    cards: {
      ...state.cards,
      [cardId]: {
        ...existing,
        locked:   true,
        revision: envelope.event.version,
        isOptimistic: envelope.optimistic ?? false,
      },
    },
  };
}

// ─── Unlock ──────────────────────────────────────────────────────────────────

export function applyCardUnlocked(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<CardUnlockedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { cardId } = envelope.event.payload;
  const existing = state.cards[cardId];
  if (!existing) return {};

  if (existing.revision >= envelope.event.version) return {};

  return {
    cards: {
      ...state.cards,
      [cardId]: {
        ...existing,
        locked:   false,
        revision: envelope.event.version,
        isOptimistic: envelope.optimistic ?? false,
      },
    },
  };
}
