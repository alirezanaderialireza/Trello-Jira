// packages/domain/src/events/comment.events.ts
//
// Phase 1.2 (F1.2.4.a) — upgraded to schemaVersion 2.
//
// v1 → v2 changes:
//   CommentCreatedPayload  : + revision: number (D7)
//   CommentDeletedPayload  : + deletedBy: string (D7 — for F1.2.8 timeline)
//   CommentUpdatedPayload  : unchanged in field list but schemaVersion now 2
//
// No v1 backward-compat payload needed — the Phase-4 stub router never
// emitted outbox events, so no consumer has ever received a v1 comment event.

import type { DomainEvent } from "./base";

// ============================================================================
// 1. Comment Created (schemaVersion 2)
// ============================================================================
export interface CommentCreatedPayload {
  readonly commentId:  string;
  readonly cardId:     string;
  readonly boardId:    string;
  readonly authorId:   string;
  readonly body:       string;
  readonly createdAt:  string; // ISO-8601 UTC
  /** Aggregate revision after this create — used by the store + OCC. */
  readonly revision:   number;
}
export interface CommentCreatedEvent
  extends DomainEvent<"comment.created", CommentCreatedPayload> {}

// ============================================================================
// 2. Comment Updated (schemaVersion 2)
// ============================================================================
export interface CommentUpdatedPayload {
  readonly commentId: string;
  readonly cardId:    string;
  readonly boardId:   string;
  readonly body:      string;
  readonly editedAt:  string; // ISO-8601 UTC
}
export interface CommentUpdatedEvent
  extends DomainEvent<"comment.updated", CommentUpdatedPayload> {}

// ============================================================================
// 3. Comment Deleted (schemaVersion 2)
// ============================================================================
export interface CommentDeletedPayload {
  readonly commentId: string;
  readonly cardId:    string;
  readonly boardId:   string;
  /** UserId of the actor who triggered the delete — for activity timeline. */
  readonly deletedBy: string;
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
