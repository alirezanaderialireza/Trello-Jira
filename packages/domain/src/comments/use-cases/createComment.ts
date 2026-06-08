// packages/domain/src/comments/use-cases/createComment.ts
//
// Pure use case: validates body, builds the CommentEntity and the
// CommentCreatedEvent (schemaVersion 2). All side effects (DB, clock,
// IDs) are injected — the use case is deterministic.

import type { BoardId, CardId, TenantId, UserId } from "../../shared/ids";
import type { CommentEntity, CommentId } from "../types";
import type { CommentCreatedEvent } from "../../events/comment.events";
import {
  CommentBodyRequiredError,
  CommentBodyTooLongError,
} from "../errors";

export const COMMENT_BODY_MAX_LENGTH = 5_000; // D3

export interface CreateCommentInput {
  readonly newCommentId:  CommentId;
  readonly tenantId:      TenantId;
  readonly cardId:        CardId;
  readonly boardId:       BoardId;
  readonly authorId:      UserId;
  readonly body:          string;
  /** Server clock — never trust client. */
  readonly now:           Date;
  readonly eventId:       string;
  readonly correlationId?: string;
}

export interface CreateCommentOutput {
  readonly entity: CommentEntity;
  readonly event:  CommentCreatedEvent;
}

export function createComment(input: CreateCommentInput): CreateCommentOutput {
  // ── Validation ────────────────────────────────────────────────────────────
  const trimmedBody = input.body.trim();
  if (trimmedBody.length === 0) {
    throw new CommentBodyRequiredError();
  }
  if (trimmedBody.length > COMMENT_BODY_MAX_LENGTH) {
    throw new CommentBodyTooLongError(COMMENT_BODY_MAX_LENGTH);
  }

  // ── Entity ────────────────────────────────────────────────────────────────
  const entity: CommentEntity = {
    id:        input.newCommentId,
    tenantId:  input.tenantId,
    cardId:    input.cardId,
    boardId:   input.boardId,
    authorId:  input.authorId,
    body:      trimmedBody,
    revision:  1,
    createdAt: input.now,
    updatedAt: input.now,
    editedAt:  null,
    deletedAt: null,
    deletedBy: null,
  };

  // ── Event (schemaVersion 2) ───────────────────────────────────────────────
  const event: CommentCreatedEvent = {
    id:            input.eventId,
    type:          "comment.created",
    version:       1,
    schemaVersion: 2,
    occurredAt:    input.now.toISOString(),
    aggregateId:   input.cardId,
    aggregateType: "card",
    actorId:       input.authorId,
    tenantId:      input.tenantId,
    correlationId: input.correlationId,
    payload: {
      commentId:  input.newCommentId,
      cardId:     input.cardId,
      boardId:    input.boardId,
      authorId:   input.authorId,
      body:       trimmedBody,
      createdAt:  input.now.toISOString(),
      revision:   1,
    },
  };

  return { entity, event };
}
