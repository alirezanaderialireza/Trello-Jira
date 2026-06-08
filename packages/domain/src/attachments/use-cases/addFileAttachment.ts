// packages/domain/src/attachments/use-cases/addFileAttachment.ts
//
// Pure use case: builds the AttachmentEntity + event for a confirmed
// file upload. Called by the router's confirmUpload procedure AFTER the
// browser has PUT the file to R2/MinIO.
//
// Pre-conditions the router must check before calling:
//   • card exists + belongs to boardId (topology guard)
//   • currentCount < MAX_ATTACHMENTS (AttachmentLimitError)
//   • fileSize <= MAX_FILE_SIZE_BYTES (AttachmentFileSizeError)
//   These validations are done in the router (not here) because they
//   require DB reads, which are side-effects.

import type { BoardId, CardId, TenantId } from "../../shared/ids";
import type { AttachmentEntity, AttachmentId } from "../types";
import type { AttachmentAddedEvent } from "../../events/attachment.events";

export interface AddFileAttachmentInput {
  readonly attachmentId: AttachmentId;
  readonly tenantId:     TenantId;
  readonly cardId:       CardId;
  readonly boardId:      BoardId;
  readonly url:          string;
  readonly objectKey:    string;
  readonly mimeType:     string;
  readonly fileName:     string;
  readonly sizeBytes:    number;
  readonly uploadedBy:   string;
  readonly now:          Date;
  readonly eventId:      string;
  readonly correlationId?: string;
}

export interface AddFileAttachmentOutput {
  readonly entity: AttachmentEntity;
  readonly event:  AttachmentAddedEvent;
}

export function addFileAttachment(input: AddFileAttachmentInput): AddFileAttachmentOutput {
  const entity: AttachmentEntity = {
    id:         input.attachmentId,
    tenantId:   input.tenantId,
    cardId:     input.cardId,
    boardId:    input.boardId,
    type:       "file",
    url:        input.url,
    objectKey:  input.objectKey,
    mimeType:   input.mimeType,
    fileName:   input.fileName.slice(0, 255),
    sizeBytes:  input.sizeBytes,
    title:      null,
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
      mimeType:     input.mimeType,
      fileName:     entity.fileName,
      sizeBytes:    input.sizeBytes,
      uploadedBy:   input.uploadedBy,
      createdAt:    input.now.toISOString(),
    },
  };

  return { entity, event };
}
