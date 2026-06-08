// apps/web/src/features/board/store/event-application/applyCardAssignee.ts
//
// Phase 1.2 (F1.2.5) — adapted to v2 event payload:
//   CardAssigneeAddedPayload v2:   + assignedBy (ignored at store level)
//   CardAssigneeRemovedPayload v2: + removedBy  (ignored at store level)
//
// Backward-compat: new v2 fields read with optional access so old
// optimistic envelopes (built before server echoes) still work.

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
  // assignedBy is in v2 payload but not needed for store state.
  const existing = state.cards[cardId];
  if (!existing) return {};
  if (existing.revision >= envelope.event.version) return {};

  const current = existing.assignees ?? [];
  if (current.includes(assigneeId)) return {}; // idempotent

  return {
    cards: {
      ...state.cards,
      [cardId]: {
        ...existing,
        assignees:    [...current, assigneeId],
        revision:     envelope.event.version,
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
  // removedBy is in v2 payload but not needed for store state.
  const existing = state.cards[cardId];
  if (!existing) return {};
  if (existing.revision >= envelope.event.version) return {};

  const current = existing.assignees ?? [];
  const next    = current.filter((id) => id !== assigneeId);
  if (next.length === current.length) return {}; // idempotent

  return {
    cards: {
      ...state.cards,
      [cardId]: {
        ...existing,
        assignees:    next,
        revision:     envelope.event.version,
        isOptimistic: envelope.optimistic ?? false,
      },
    },
  };
}
