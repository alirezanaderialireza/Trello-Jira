// apps/web/src/features/board/store/event-application/applyLabel.ts
import type {
  LabelCreatedEvent,
  LabelUpdatedEvent,
  LabelDeletedEvent,
} from "@repo/domain";
import type { BoardStoreState, LabelDto } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

// ─── Created ─────────────────────────────────────────────────────────────────

export function applyLabelCreated(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<LabelCreatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { labelId, boardId, name, color } = envelope.event.payload;

  const existing = state.labels[labelId];
  // Idempotent — if we already have a newer version, skip.
  if (existing && existing.revision >= envelope.event.version) return {};

  const label: LabelDto = {
    id:          labelId,
    boardId,
    name,
    color,
    revision:    envelope.event.version,
    isOptimistic: envelope.optimistic ?? false,
  };

  // Idempotent insert into labelsByBoard
  const currentBoard   = state.labelsByBoard[boardId] ?? [];
  const nextBoardLabels = currentBoard.includes(labelId)
    ? currentBoard
    : [...currentBoard, labelId];

  return {
    labels: { ...state.labels, [labelId]: label },
    labelsByBoard: { ...state.labelsByBoard, [boardId]: nextBoardLabels },
  };
}

// ─── Updated ─────────────────────────────────────────────────────────────────

export function applyLabelUpdated(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<LabelUpdatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { labelId, changes } = envelope.event.payload;
  const existing = state.labels[labelId];
  if (!existing) return {};
  if (existing.revision >= envelope.event.version) return {};

  return {
    labels: {
      ...state.labels,
      [labelId]: {
        ...existing,
        ...changes,
        revision:    envelope.event.version,
        isOptimistic: envelope.optimistic ?? false,
      },
    },
  };
}

// ─── Deleted ─────────────────────────────────────────────────────────────────

export function applyLabelDeleted(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<LabelDeletedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { labelId, boardId } = envelope.event.payload;
  if (!state.labels[labelId]) return {};

  const { [labelId]: _removed, ...remainingLabels } = state.labels;

  const currentBoard  = state.labelsByBoard[boardId] ?? [];
  const nextBoardLabels = currentBoard.filter((id) => id !== labelId);

  // Remove this labelId from every card that references it — projection clean-up.
  const nextCards = { ...state.cards };
  Object.keys(nextCards).forEach((cardId) => {
    const card = nextCards[cardId];
    if (card.labels?.includes(labelId)) {
      nextCards[cardId] = {
        ...card,
        labels: card.labels.filter((id) => id !== labelId),
      };
    }
  });

  return {
    labels:       remainingLabels,
    labelsByBoard: { ...state.labelsByBoard, [boardId]: nextBoardLabels },
    cards:        nextCards,
  };
}
