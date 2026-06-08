// packages/domain/src/comments/use-cases/updateComment.ts
//
// Pure use case: validates a body update, detects no-ops (same body
// after trim), and builds the CommentUpdatedEvent.
// Returns a discriminated union: { noOp: true } | { noOp: false; … }.

import type { UserId } from "../../shared/ids";
import type { CommentEntity, CommentPatch } from "../types";
import type { CommentUpdatedEvent } from "../../events/comment.events";
import {
  CommentBodyRequiredError,
  CommentBodyTooLongError,
} from "../errors";
import { COMMENT_BODY_MAX_LENGTH } from "./createComment";

export interface UpdateCommentInput {
  readonly current:        CommentEntity;
  readonly body:           string;
  readonly actorId:        UserId;
  readonly now:            Date;
  readonly eventId:        string;
  readonly correlationId?: string;
}

export type UpdateCommentOutput =
  | { readonly noOp: true;  readonly patch: CommentPatch }
  | { readonly noOp: false; readonly patch: CommentPatch; readonly event: CommentUpdatedEvent };

export function updateComment(input: UpdateCommentInput): UpdateCommentOutput {
  // ── Validation ────────────────────────────────────────────────────────────
  const trimmedBody = input.body.trim();
  if (trimmedBody.length === 0) {
    throw new CommentBodyRequiredError();
  }
  if (trimmedBody.length > COMMENT_BODY_MAX_LENGTH) {
    throw new CommentBodyTooLongError(COMMENT_BODY_MAX_LENGTH);
  }

  // ── No-op detection ───────────────────────────────────────────────────────
  if (trimmedBody === input.current.body) {
    return { noOp: true, patch: {} };
  }

  const newRevision = input.current.revision + 1;
  const editedAt    = input.now;

  const patch: CommentPatch = {
    body:      trimmedBody,
    editedAt,
    updatedAt: input.now,
    revision:  newRevision,
  };

  const event: CommentUpdatedEvent = {
    id:            input.eventId,
    type:          "comment.updated",
    version:       newRevision,
    schemaVersion: 2,
    occurredAt:    input.now.toISOString(),
    aggregateId:   input.current.cardId,
    aggregateType: "card",
    actorId:       input.actorId,
    tenantId:      input.current.tenantId,
    correlationId: input.correlationId,
    payload: {
      commentId: input.current.id,
      cardId:    input.current.cardId,
      boardId:   input.current.boardId,
      body:      trimmedBody,
      editedAt:  editedAt.toISOString(),
    },
  };

  return { noOp: false, patch, event };
}
