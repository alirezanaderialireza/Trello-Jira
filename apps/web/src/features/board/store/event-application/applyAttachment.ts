// apps/web/src/features/board/store/event-application/applyAttachment.ts
import type {
  AttachmentAddedEvent,
  AttachmentRemovedEvent,
} from "@repo/domain";
import type { BoardStoreState, AttachmentDto } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

// ─── Added ───────────────────────────────────────────────────────────────────

export function applyAttachmentAdded(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<AttachmentAddedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { attachmentId, cardId, boardId, url, mimeType, fileName, sizeBytes, uploadedBy, createdAt } =
    envelope.event.payload;

  // Idempotent: attachments are immutable once uploaded — skip if already present.
  if (state.attachments[attachmentId]) return {};

  const attachment: AttachmentDto = {
    id:          attachmentId,
    cardId,
    boardId,
    url,
    mimeType,
    fileName,
    sizeBytes,
    uploadedBy,
    createdAt,
    isOptimistic: envelope.optimistic ?? false,
  };

  const currentCard   = state.attachmentsByCard[cardId] ?? [];
  const nextCardAtchs = currentCard.includes(attachmentId)
    ? currentCard
    : [...currentCard, attachmentId];

  // Maintain card.attachments projection array.
  const card = state.cards[cardId];
  const nextCards = card
    ? {
        ...state.cards,
        [cardId]: {
          ...card,
          attachments: nextCardAtchs,
        },
      }
    : state.cards;

  return {
    attachments:       { ...state.attachments, [attachmentId]: attachment },
    attachmentsByCard: { ...state.attachmentsByCard, [cardId]: nextCardAtchs },
    cards:             nextCards,
  };
}

// ─── Removed ─────────────────────────────────────────────────────────────────

export function applyAttachmentRemoved(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<AttachmentRemovedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { attachmentId, cardId } = envelope.event.payload;
  if (!state.attachments[attachmentId]) return {};

  const { [attachmentId]: _removed, ...remainingAttachments } = state.attachments;

  const currentCard   = state.attachmentsByCard[cardId] ?? [];
  const nextCardAtchs = currentCard.filter((id) => id !== attachmentId);

  // Remove from card.attachments projection.
  const card = state.cards[cardId];
  const nextCards = card
    ? {
        ...state.cards,
        [cardId]: {
          ...card,
          attachments: (card.attachments ?? []).filter((id) => id !== attachmentId),
        },
      }
    : state.cards;

  return {
    attachments:       remainingAttachments,
    attachmentsByCard: { ...state.attachmentsByCard, [cardId]: nextCardAtchs },
    cards:             nextCards,
  };
}
