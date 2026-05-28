// apps/web/src/features/board/store/event-application/applyChecklist.ts
//
// Phase 1.2 (F1.2.3.a) — adapted to event payload v2.
//
//   v1 (Phase 4 stub):
//     ChecklistCreatedPayload    → name, items[]
//     ChecklistItemAddedPayload  → item.{ title, completed }
//     ChecklistItemUpdatedPayload → changes.{ title, completed }
//     ChecklistDeletedPayload    → no count
//
//   v2 (this version, schemaVersion 2):
//     ChecklistCreatedPayload    → title, position, createdBy
//                                  (items array dropped — initial
//                                  items always empty in F1.2.3.a;
//                                  items added via separate event so
//                                  the activity timeline has one event
//                                  per addition)
//     ChecklistItemAddedPayload  → flattened: { checklistItemId, text,
//                                  isDone, position, addedBy }
//     ChecklistItemUpdatedPayload → changes.{ text, isDone, position }
//                                  (D10 toggle / D11 reorder /
//                                  rename in one payload)
//     ChecklistDeletedPayload    → +affectedItemCount (informational
//                                  — not consumed by the reducer)
//
// New: ChecklistUpdatedEvent (D12 reorder/rename of the parent).
//
// The reducer reads only the fields that change board store state;
// audit fields (createdBy / addedBy / actorId on the event envelope)
// are for the activity timeline (F1.2.6) but not for state derivation.

import type {
  ChecklistCreatedEvent,
  ChecklistUpdatedEvent,
  ChecklistDeletedEvent,
  ChecklistItemAddedEvent,
  ChecklistItemUpdatedEvent,
  ChecklistItemRemovedEvent,
} from "@repo/domain";
import type {
  BoardStoreState,
  ChecklistDto,
  ChecklistItemDto,
} from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

// ─── Created ─────────────────────────────────────────────────────────────────

export function applyChecklistCreated(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<ChecklistCreatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { checklistId, cardId, boardId, title, position } =
    envelope.event.payload;

  const existing = state.checklists[checklistId];
  if (existing && existing.revision >= envelope.event.version) return {};

  const checklist: ChecklistDto = {
    id:           checklistId,
    cardId,
    boardId,
    title,
    position,
    items:        [], // v2: initial items always empty.
    revision:     envelope.event.version,
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

// ─── Updated ─────────────────────────────────────────────────────────────────
// NEW in F1.2.3.a — D12 reorder + rename of the parent checklist.

export function applyChecklistUpdated(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<ChecklistUpdatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { checklistId, changes } = envelope.event.payload;
  const existing = state.checklists[checklistId];
  if (!existing) return {};
  if (existing.revision >= envelope.event.version) return {};

  return {
    checklists: {
      ...state.checklists,
      [checklistId]: {
        ...existing,
        ...(changes.title    !== undefined && { title:    changes.title }),
        ...(changes.position !== undefined && { position: changes.position }),
        revision:     envelope.event.version,
        isOptimistic: envelope.optimistic ?? false,
      },
    },
  };
}

// ─── Item Added ──────────────────────────────────────────────────────────────

export function applyChecklistItemAdded(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<ChecklistItemAddedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { checklistId, checklistItemId, text, isDone, position } =
    envelope.event.payload;
  const existing = state.checklists[checklistId];
  if (!existing) return {};
  if (existing.revision >= envelope.event.version) return {};

  // Idempotent: skip if item already present.
  if (existing.items.some((i) => i.id === checklistItemId)) return {};

  const newItem: ChecklistItemDto = {
    id:       checklistItemId,
    text,
    isDone,
    position,
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
  const { checklistId, checklistItemId, changes } = envelope.event.payload;
  const existing = state.checklists[checklistId];
  if (!existing) return {};
  if (existing.revision >= envelope.event.version) return {};

  const itemIdx = existing.items.findIndex((i) => i.id === checklistItemId);
  if (itemIdx === -1) return {};

  const nextItems = existing.items.map((item) =>
    item.id === checklistItemId
      ? {
          ...item,
          ...(changes.text     !== undefined && { text:     changes.text }),
          ...(changes.isDone   !== undefined && { isDone:   changes.isDone }),
          ...(changes.position !== undefined && { position: changes.position }),
        }
      : item,
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
  const { checklistId, checklistItemId } = envelope.event.payload;
  const existing = state.checklists[checklistId];
  if (!existing) return {};
  if (existing.revision >= envelope.event.version) return {};

  const nextItems = existing.items.filter((i) => i.id !== checklistItemId);
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
