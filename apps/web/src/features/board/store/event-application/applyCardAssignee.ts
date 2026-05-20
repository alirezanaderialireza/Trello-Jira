// apps/web/src/features/board/store/event-application/applyCardAssignee.ts
import type {
  CardAssigneeAddedEvent,
  CardAssigneeRemovedEvent,
} from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

// ─── Assignee Added ──────────────────────────────────────────────────────────

export function applyCardAssigneeAdded(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<CardAssigneeAddedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { cardId, assigneeId } = envelope.event.payload;
  const existing = state.cards[cardId];
  if (!existing) return {};
  if (existing.revision >= envelope.event.version) return {};

  const current   = existing.assignees ?? [];
  // Idempotent — never add a duplicate assignee.
  if (current.includes(assigneeId)) return {};

  return {
    cards: {
      ...state.cards,
      [cardId]: {
        ...existing,
        assignees:   [...current, assigneeId],
        revision:    envelope.event.version,
        isOptimistic: envelope.optimistic ?? false,
      },
    },
  };
}

// ─── Assignee Removed ────────────────────────────────────────────────────────

export function applyCardAssigneeRemoved(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<CardAssigneeRemovedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { cardId, assigneeId } = envelope.event.payload;
  const existing = state.cards[cardId];
  if (!existing) return {};
  if (existing.revision >= envelope.event.version) return {};

  const current = existing.assignees ?? [];
  // Idempotent — safe when the assignee was never present.
  const next = current.filter((id) => id !== assigneeId);
  if (next.length === current.length) return {};

  return {
    cards: {
      ...state.cards,
      [cardId]: {
        ...existing,
        assignees:   next,
        revision:    envelope.event.version,
        isOptimistic: envelope.optimistic ?? false,
      },
    },
  };
}
