// apps/web/src/features/board/store/event-application/applyCardLabel.ts
import type {
  CardLabelAddedEvent,
  CardLabelRemovedEvent,
} from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

// ─── Label Added ─────────────────────────────────────────────────────────────

export function applyCardLabelAdded(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<CardLabelAddedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { cardId, labelId } = envelope.event.payload;
  const existing = state.cards[cardId];
  if (!existing) return {};
  if (existing.revision >= envelope.event.version) return {};

  const current = existing.labels ?? [];
  if (current.includes(labelId)) return {};

  return {
    cards: {
      ...state.cards,
      [cardId]: {
        ...existing,
        labels:      [...current, labelId],
        revision:    envelope.event.version,
        isOptimistic: envelope.optimistic ?? false,
      },
    },
  };
}

// ─── Label Removed ───────────────────────────────────────────────────────────

export function applyCardLabelRemoved(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<CardLabelRemovedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { cardId, labelId } = envelope.event.payload;
  const existing = state.cards[cardId];
  if (!existing) return {};
  if (existing.revision >= envelope.event.version) return {};

  const current = existing.labels ?? [];
  const next    = current.filter((id) => id !== labelId);
  if (next.length === current.length) return {};

  return {
    cards: {
      ...state.cards,
      [cardId]: {
        ...existing,
        labels:      next,
        revision:    envelope.event.version,
        isOptimistic: envelope.optimistic ?? false,
      },
    },
  };
}
