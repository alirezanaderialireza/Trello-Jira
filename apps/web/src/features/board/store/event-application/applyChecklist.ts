// apps/web/src/features/board/store/event-application/applyChecklist.ts
import type {
  ChecklistCreatedEvent,
  ChecklistItemAddedEvent,
  ChecklistItemUpdatedEvent,
  ChecklistItemRemovedEvent,
  ChecklistDeletedEvent,
} from "@repo/domain";
import type { BoardStoreState, ChecklistDto, ChecklistItemDto } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

// ─── Created ─────────────────────────────────────────────────────────────────

export function applyChecklistCreated(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<ChecklistCreatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { checklistId, cardId, boardId, name, items } = envelope.event.payload;

  const existing = state.checklists[checklistId];
  if (existing && existing.revision >= envelope.event.version) return {};

  const checklist: ChecklistDto = {
    id:          checklistId,
    cardId,
    boardId,
    name,
    items:       items.map((i) => ({ id: i.id, title: i.title, completed: i.completed })),
    revision:    envelope.event.version,
    isOptimistic: envelope.optimistic ?? false,
  };

  const currentCard   = state.checklistsByCard[cardId] ?? [];
  const nextCardLists = currentCard.includes(checklistId)
    ? currentCard
    : [...currentCard, checklistId];

  // Register checklistId in the card's checklists array (if card exists).
  const nextCards = state.cards[cardId]
    ? {
        ...state.cards,
        [cardId]: {
          ...state.cards[cardId],
          checklists: nextCardLists,
        },
      }
    : state.cards;

  return {
    checklists:       { ...state.checklists, [checklistId]: checklist },
    checklistsByCard: { ...state.checklistsByCard, [cardId]: nextCardLists },
    cards:            nextCards,
  };
}

// ─── Item Added ──────────────────────────────────────────────────────────────

export function applyChecklistItemAdded(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<ChecklistItemAddedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { checklistId, item } = envelope.event.payload;
  const existing = state.checklists[checklistId];
  if (!existing) return {};
  if (existing.revision >= envelope.event.version) return {};

  // Idempotent: skip if item already present.
  if (existing.items.some((i) => i.id === item.id)) return {};

  const newItem: ChecklistItemDto = {
    id:        item.id,
    title:     item.title,
    completed: item.completed,
  };

  return {
    checklists: {
      ...state.checklists,
      [checklistId]: {
        ...existing,
        items:    [...existing.items, newItem],
        revision: envelope.event.version,
        isOptimistic: envelope.optimistic ?? false,
      },
    },
  };
}

// ─── Item Updated ─────────────────────────────────────────────────────────────

export function applyChecklistItemUpdated(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<ChecklistItemUpdatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { checklistId, itemId, changes } = envelope.event.payload;
  const existing = state.checklists[checklistId];
  if (!existing) return {};
  if (existing.revision >= envelope.event.version) return {};

  const itemIdx = existing.items.findIndex((i) => i.id === itemId);
  if (itemIdx === -1) return {};

  const nextItems = existing.items.map((item) =>
    item.id === itemId ? { ...item, ...changes } : item,
  );

  return {
    checklists: {
      ...state.checklists,
      [checklistId]: {
        ...existing,
        items:    nextItems,
        revision: envelope.event.version,
        isOptimistic: envelope.optimistic ?? false,
      },
    },
  };
}

// ─── Item Removed ─────────────────────────────────────────────────────────────

export function applyChecklistItemRemoved(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<ChecklistItemRemovedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { checklistId, itemId } = envelope.event.payload;
  const existing = state.checklists[checklistId];
  if (!existing) return {};
  if (existing.revision >= envelope.event.version) return {};

  const nextItems = existing.items.filter((i) => i.id !== itemId);
  if (nextItems.length === existing.items.length) return {}; // idempotent

  return {
    checklists: {
      ...state.checklists,
      [checklistId]: {
        ...existing,
        items:    nextItems,
        revision: envelope.event.version,
        isOptimistic: envelope.optimistic ?? false,
      },
    },
  };
}

// ─── Deleted ─────────────────────────────────────────────────────────────────

export function applyChecklistDeleted(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<ChecklistDeletedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { checklistId, cardId } = envelope.event.payload;
  if (!state.checklists[checklistId]) return {};

  const { [checklistId]: _removed, ...remainingChecklists } = state.checklists;

  const currentCard   = state.checklistsByCard[cardId] ?? [];
  const nextCardLists = currentCard.filter((id) => id !== checklistId);

  // Remove from card.checklists array projection.
  const card = state.cards[cardId];
  const nextCards = card
    ? {
        ...state.cards,
        [cardId]: {
          ...card,
          checklists: (card.checklists ?? []).filter((id) => id !== checklistId),
        },
      }
    : state.cards;

  return {
    checklists:       remainingChecklists,
    checklistsByCard: { ...state.checklistsByCard, [cardId]: nextCardLists },
    cards:            nextCards,
  };
}
