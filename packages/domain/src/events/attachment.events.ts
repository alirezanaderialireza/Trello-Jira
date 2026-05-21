// packages/domain/src/events/attachment.events.ts
import type { DomainEvent } from "./base";

// ============================================================================
// 1. Attachment Added
// ============================================================================
export interface AttachmentAddedPayload {
  readonly attachmentId: string;
  readonly cardId: string;
  readonly boardId: string;
  readonly url: string;
  /** MIME type, e.g. "image/png", "application/pdf" */
  readonly mimeType: string;
  readonly fileName: string;
  /** File size in bytes. */
  readonly sizeBytes: number;
  readonly uploadedBy: string; // userId
  readonly createdAt: string;  // ISO-8601 UTC
}
export interface AttachmentAddedEvent
  extends DomainEvent<"attachment.added", AttachmentAddedPayload> {}

// ============================================================================
// 2. Attachment Removed
// ============================================================================
export interface AttachmentRemovedPayload {
  readonly attachmentId: string;
  readonly cardId: string;
  readonly boardId: string;
}
export interface AttachmentRemovedEvent
  extends DomainEvent<"attachment.removed", AttachmentRemovedPayload> {}

// ============================================================================
// Aggregate Type Export
// ============================================================================
export type AttachmentEvent = AttachmentAddedEvent | AttachmentRemovedEvent;
