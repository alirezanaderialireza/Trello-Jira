// apps/web/src/features/board/store/event-application/applyComment.ts
import type {
  CommentCreatedEvent,
  CommentUpdatedEvent,
  CommentDeletedEvent,
} from "@repo/domain";
import type { BoardStoreState, CommentDto } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

// ─── Created ─────────────────────────────────────────────────────────────────

export function applyCommentCreated(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<CommentCreatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { commentId, cardId, boardId, authorId, body, createdAt } =
    envelope.event.payload;

  // Idempotent: skip if this comment already exists at the same or higher version.
  const existing = state.comments[commentId];
  if (existing && existing.revision >= envelope.event.version) return {};

  const comment: CommentDto = {
    id:          commentId,
    cardId,
    boardId,
    authorId,
    body,
    createdAt,
    revision:    envelope.event.version,
    isOptimistic: envelope.optimistic ?? false,
  };

  const currentCard  = state.commentsByCard[cardId] ?? [];
  // Idempotent append — preserve insertion order.
  const nextCardComments = currentCard.includes(commentId)
    ? currentCard
    : [...currentCard, commentId];

  return {
    comments:       { ...state.comments, [commentId]: comment },
    commentsByCard: { ...state.commentsByCard, [cardId]: nextCardComments },
  };
}

// ─── Updated ─────────────────────────────────────────────────────────────────

export function applyCommentUpdated(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<CommentUpdatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { commentId, body, editedAt } = envelope.event.payload;
  const existing = state.comments[commentId];
  if (!existing) return {};
  if (existing.revision >= envelope.event.version) return {};

  return {
    comments: {
      ...state.comments,
      [commentId]: {
        ...existing,
        body,
        editedAt,
        revision:    envelope.event.version,
        isOptimistic: envelope.optimistic ?? false,
      },
    },
  };
}

// ─── Deleted ─────────────────────────────────────────────────────────────────

export function applyCommentDeleted(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<CommentDeletedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { commentId, cardId } = envelope.event.payload;
  if (!state.comments[commentId]) return {};

  const { [commentId]: _removed, ...remainingComments } = state.comments;

  const currentCard     = state.commentsByCard[cardId] ?? [];
  const nextCardComments = currentCard.filter((id) => id !== commentId);

  return {
    comments:       remainingComments,
    commentsByCard: { ...state.commentsByCard, [cardId]: nextCardComments },
  };
}
