// apps/web/src/features/board/store/event-application/applyComment.ts
//
// Phase 1.2 (F1.2.4.a) — adapted to v2 event payload shape:
//   CommentCreatedPayload  : + revision (D7)
//   CommentDeletedPayload  : + deletedBy (D7 — ignored at store level,
//                             used by activity timeline F1.2.8)
//
// Backward-compat: all new v2 fields read with ?? so an optimistic
// envelope built client-side before the server echoes can still be
// applied without crashing.

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

  // v2: payload carries revision; fall back to envelope version for optimistic.
  const revision: number =
    (envelope.event.payload as any).revision ?? envelope.event.version;

  // Idempotent: skip if already at same or higher revision.
  const existing = state.comments[commentId];
  if (existing && existing.revision >= revision) return {};

  const comment: CommentDto = {
    id:           commentId,
    cardId,
    boardId,
    authorId,
    body,
    createdAt,
    revision,
    isOptimistic: envelope.optimistic ?? false,
  };

  const currentCard      = state.commentsByCard[cardId] ?? [];
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
        revision:     envelope.event.version,
        isOptimistic: envelope.optimistic ?? false,
      },
    },
  };
}

// ─── Deleted ─────────────────────────────────────────────────────────────────
// v2: payload now carries `deletedBy` — ignored here (activity timeline).

export function applyCommentDeleted(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<CommentDeletedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { commentId, cardId } = envelope.event.payload;
  if (!state.comments[commentId]) return {};

  const { [commentId]: _removed, ...remainingComments } = state.comments;

  const currentCard      = state.commentsByCard[cardId] ?? [];
  const nextCardComments = currentCard.filter((id) => id !== commentId);

  return {
    comments:       remainingComments,
    commentsByCard: { ...state.commentsByCard, [cardId]: nextCardComments },
  };
}
