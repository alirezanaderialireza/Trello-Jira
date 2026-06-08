// packages/domain/src/attachments/use-cases/removeAttachment.ts
//
// Pure use case: builds the AttachmentRemovedEvent for a soft-delete.
// Auth check (uploader OR admin) is enforced by the router before calling.

import type { AttachmentEntity } from "../types";
import type { AttachmentRemovedEvent } from "../../events/attachment.events";

export interface RemoveAttachmentInput {
  readonly current:        AttachmentEntity;
  readonly actorId:        string;
  readonly now:            Date;
  readonly eventId:        string;
  readonly correlationId?: string;
}

export interface RemoveAttachmentOutput {
  readonly event: AttachmentRemovedEvent;
}

export function removeAttachment(input: RemoveAttachmentInput): RemoveAttachmentOutput {
  const event: AttachmentRemovedEvent = {
    id:            input.eventId,
    type:          "attachment.removed",
    version:       1,
    schemaVersion: 2,
    occurredAt:    input.now.toISOString(),
    aggregateId:   input.current.cardId,
    aggregateType: "card",
    actorId:       input.actorId,
    tenantId:      input.current.tenantId,
    correlationId: input.correlationId,
    payload: {
      attachmentId: input.current.id,
      cardId:       input.current.cardId,
      boardId:      input.current.boardId,
    },
  };

  return { event };
}
