// packages/domain/src/events/comment.events.ts
import type { DomainEvent } from "./base";

// ============================================================================
// 1. Comment Created
// ============================================================================
export interface CommentCreatedPayload {
  readonly commentId: string;
  readonly cardId: string;
  readonly boardId: string;
  readonly authorId: string;
  readonly body: string;
  readonly createdAt: string; // ISO-8601 UTC
}
export interface CommentCreatedEvent
  extends DomainEvent<"comment.created", CommentCreatedPayload> {}

// ============================================================================
// 2. Comment Updated
// ============================================================================
export interface CommentUpdatedPayload {
  readonly commentId: string;
  readonly cardId: string;
  readonly boardId: string;
  readonly body: string;
  readonly editedAt: string; // ISO-8601 UTC
}
export interface CommentUpdatedEvent
  extends DomainEvent<"comment.updated", CommentUpdatedPayload> {}

// ============================================================================
// 3. Comment Deleted
// ============================================================================
export interface CommentDeletedPayload {
  readonly commentId: string;
  readonly cardId: string;
  readonly boardId: string;
}
export interface CommentDeletedEvent
  extends DomainEvent<"comment.deleted", CommentDeletedPayload> {}

// ============================================================================
// Aggregate Type Export
// ============================================================================
export type CommentEvent =
  | CommentCreatedEvent
  | CommentUpdatedEvent
  | CommentDeletedEvent;
