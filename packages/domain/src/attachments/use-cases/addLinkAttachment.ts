// packages/domain/src/attachments/use-cases/addLinkAttachment.ts
//
// Pure use case: builds entity + event for an external link attachment.
// No upload required — just URL + optional title.

import type { BoardId, CardId, TenantId } from "../../shared/ids";
import type { AttachmentEntity, AttachmentId } from "../types";
import type { AttachmentAddedEvent } from "../../events/attachment.events";

export interface AddLinkAttachmentInput {
  readonly attachmentId: AttachmentId;
  readonly tenantId:     TenantId;
  readonly cardId:       CardId;
  readonly boardId:      BoardId;
  readonly url:          string;
  readonly title:        string | null;
  readonly uploadedBy:   string;
  readonly now:          Date;
  readonly eventId:      string;
  readonly correlationId?: string;
}

export interface AddLinkAttachmentOutput {
  readonly entity: AttachmentEntity;
  readonly event:  AttachmentAddedEvent;
}

export function addLinkAttachment(input: AddLinkAttachmentInput): AddLinkAttachmentOutput {
  // Use hostname as a display name when no title is provided.
  const displayTitle = input.title?.trim() || null;
  const fileName = displayTitle ?? (() => {
    try { return new URL(input.url).hostname; } catch { return input.url.slice(0, 255); }
  })();

  const entity: AttachmentEntity = {
    id:         input.attachmentId,
    tenantId:   input.tenantId,
    cardId:     input.cardId,
    boardId:    input.boardId,
    type:       "link",
    url:        input.url,
    objectKey:  null,
    mimeType:   "text/uri-list",
    fileName:   fileName.slice(0, 255),
    sizeBytes:  null,
    title:      displayTitle,
    uploadedBy: input.uploadedBy,
    createdAt:  input.now,
    deletedAt:  null,
  };

  const event: AttachmentAddedEvent = {
    id:            input.eventId,
    type:          "attachment.added",
    version:       1,
    schemaVersion: 2,
    occurredAt:    input.now.toISOString(),
    aggregateId:   input.cardId,
    aggregateType: "card",
    actorId:       input.uploadedBy,
    tenantId:      input.tenantId,
    correlationId: input.correlationId,
    payload: {
      attachmentId: input.attachmentId,
      cardId:       input.cardId,
      boardId:      input.boardId,
      url:          input.url,
      mimeType:     "text/uri-list",
      fileName:     entity.fileName,
      sizeBytes:    0,
      uploadedBy:   input.uploadedBy,
      createdAt:    input.now.toISOString(),
    },
  };

  return { entity, event };
}
