// apps/web/src/features/board/store/event-application/applyTemplate.ts
import type {
  TemplateCreatedEvent,
  TemplateUpdatedEvent,
  TemplateDeletedEvent,
  TemplateAppliedEvent,
} from "@repo/domain";
import type { BoardStoreState, TemplateDto } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

// ─── Created ─────────────────────────────────────────────────────────────────

export function applyTemplateCreated(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<TemplateCreatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { templateId, boardId, name, description, structure, createdAt } =
    envelope.event.payload;

  const existing = state.templates[templateId];
  if (existing && existing.revision >= envelope.event.version) return {};

  const template: TemplateDto = {
    id:          templateId,
    boardId,
    name,
    description,
    structure: {
      lists: structure.lists.map((l) => ({
        id: l.id, title: l.title, position: l.position,
      })),
      cards: structure.cards.map((c) => ({
        id: c.id, title: c.title, position: c.position,
        listId: c.listId, description: c.description,
      })),
    },
    createdAt,
    updatedAt:   createdAt,
    revision:    envelope.event.version,
    isOptimistic: envelope.optimistic ?? false,
  };

  const currentBoard     = state.templatesByBoard[boardId] ?? [];
  const nextBoardTemplates = currentBoard.includes(templateId)
    ? currentBoard
    : [...currentBoard, templateId];

  return {
    templates:        { ...state.templates, [templateId]: template },
    templatesByBoard: { ...state.templatesByBoard, [boardId]: nextBoardTemplates },
  };
}

// ─── Updated ─────────────────────────────────────────────────────────────────

export function applyTemplateUpdated(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<TemplateUpdatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { templateId, changes, updatedAt } = envelope.event.payload;
  const existing = state.templates[templateId];
  if (!existing) return {};
  if (existing.revision >= envelope.event.version) return {};

  // Structure changes need the same shape normalisation as creation.
  const nextStructure = changes.structure
    ? {
        lists: changes.structure.lists.map((l) => ({
          id: l.id, title: l.title, position: l.position,
        })),
        cards: changes.structure.cards.map((c) => ({
          id: c.id, title: c.title, position: c.position,
          listId: c.listId, description: c.description,
        })),
      }
    : existing.structure;

  return {
    templates: {
      ...state.templates,
      [templateId]: {
        ...existing,
        ...(changes.name        !== undefined && { name:        changes.name }),
        ...(changes.description !== undefined && { description: changes.description }),
        structure:   nextStructure,
        updatedAt,
        revision:    envelope.event.version,
        isOptimistic: envelope.optimistic ?? false,
      },
    },
  };
}

// ─── Deleted ─────────────────────────────────────────────────────────────────

export function applyTemplateDeleted(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<TemplateDeletedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { templateId, boardId } = envelope.event.payload;
  if (!state.templates[templateId]) return {};

  const { [templateId]: _removed, ...remainingTemplates } = state.templates;

  const currentBoard     = state.templatesByBoard[boardId] ?? [];
  const nextBoardTemplates = currentBoard.filter((id) => id !== templateId);

  return {
    templates:        remainingTemplates,
    templatesByBoard: { ...state.templatesByBoard, [boardId]: nextBoardTemplates },
  };
}

// ─── Applied ─────────────────────────────────────────────────────────────────
// When a template is applied, the server emits the individual list.created and
// card.created events.  This reducer only records the activity; the structural
// changes are handled by the existing applyListCreated / applyCardCreated.

export function applyTemplateApplied(
  state: BoardStoreState,
  _envelope: ClientEventEnvelope<TemplateAppliedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  // No structural state to mutate here — the board reconstruction is driven by
  // the individual entity events the server emits as a consequence of applying
  // the template.  The activity system captures the composite event.
  return {};
}
