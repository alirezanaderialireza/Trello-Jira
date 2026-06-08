// packages/domain/src/comments/use-cases/deleteComment.ts
//
// Pure use case: builds the CommentDeletedEvent for a soft-delete.
// Authorisation (author OR admin/owner) is enforced by the router
// before this is called — mirrors deleteChecklist.ts.
// Body is intentionally preserved in the DB (D4=ب); UI decides display.

import type { UserId } from "../../shared/ids";
import type { CommentEntity, CommentDeletePatch } from "../types";
import type { CommentDeletedEvent } from "../../events/comment.events";

export interface DeleteCommentInput {
  readonly current:        CommentEntity;
  readonly actorId:        UserId;
  readonly now:            Date;
  readonly eventId:        string;
  readonly correlationId?: string;
}

export interface DeleteCommentOutput {
  readonly patch: CommentDeletePatch;
  readonly event: CommentDeletedEvent;
}

export function deleteComment(input: DeleteCommentInput): DeleteCommentOutput {
  const newRevision = input.current.revision + 1;

  const patch: CommentDeletePatch = {
    deletedAt: input.now,
    deletedBy: input.actorId,
    updatedAt: input.now,
    revision:  newRevision,
  };

  const event: CommentDeletedEvent = {
    id:            input.eventId,
    type:          "comment.deleted",
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
      deletedBy: input.actorId,
    },
  };

  return { patch, event };
}
