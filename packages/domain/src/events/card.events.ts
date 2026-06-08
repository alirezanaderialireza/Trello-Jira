// packages/domain/src/events/card.events.ts
import type { DomainEvent } from "./base";

// ============================================================================
// 1. Card Moved
// ============================================================================
export interface CardMovedPayload {
  readonly cardId: string;
  readonly fromListId: string;
  readonly toListId: string;
  readonly oldPosition: string;
  readonly newPosition: string;
  readonly boardId: string;
}
export interface CardMovedEvent
  extends DomainEvent<"card.moved", CardMovedPayload> {}

// ============================================================================
// 2. Card Created
// ============================================================================
export interface CardCreatedPayload {
  readonly cardId: string;
  readonly listId: string;
  readonly boardId: string;
  readonly title: string;
  readonly position: string;
}
export interface CardCreatedEvent
  extends DomainEvent<"card.created", CardCreatedPayload> {}

// ============================================================================
// 3. Card Updated
// ============================================================================
export interface CardUpdatedPayload {
  readonly cardId: string;
  readonly boardId: string;
  readonly changes: {
    readonly title?: string;
    readonly description?: string;
  };
}
export interface CardUpdatedEvent
  extends DomainEvent<"card.updated", CardUpdatedPayload> {}

// ============================================================================
// 4. Card Deleted
// ============================================================================
export interface CardDeletedPayload {
  readonly cardId: string;
  readonly boardId: string;
}
export interface CardDeletedEvent
  extends DomainEvent<"card.deleted", CardDeletedPayload> {}

// ============================================================================
// 5. Card Locked  — blocks edits for non-admins
// ============================================================================
export interface CardLockedPayload {
  readonly cardId: string;
  readonly boardId: string;
  readonly lockedBy: string; // userId
}
export interface CardLockedEvent
  extends DomainEvent<"card.locked", CardLockedPayload> {}

// ============================================================================
// 6. Card Unlocked
// ============================================================================
export interface CardUnlockedPayload {
  readonly cardId: string;
  readonly boardId: string;
  readonly unlockedBy: string; // userId
}
export interface CardUnlockedEvent
  extends DomainEvent<"card.unlocked", CardUnlockedPayload> {}

// ============================================================================
// 7. Card Assignee Added  (schemaVersion 2 — F1.2.5)
// ============================================================================
// v1 (Phase-4 stub) — payload had only { cardId, boardId, assigneeId }.
// v2 adds `assignedBy` for the Activity Timeline (F1.2.8). No v1
// backward-compat needed — the stub router never emitted outbox events.
export interface CardAssigneeAddedPayload {
  readonly cardId:     string;
  readonly boardId:    string;
  readonly assigneeId: string; // userId
  readonly assignedBy: string; // userId of the actor (v2 addition)
}
export interface CardAssigneeAddedEvent
  extends DomainEvent<"card.assignee_added", CardAssigneeAddedPayload> {}

// ============================================================================
// 8. Card Assignee Removed  (schemaVersion 2 — F1.2.5)
// ============================================================================
// v2 adds `removedBy` for Activity Timeline (F1.2.8).
export interface CardAssigneeRemovedPayload {
  readonly cardId:     string;
  readonly boardId:    string;
  readonly assigneeId: string; // userId
  readonly removedBy:  string; // userId of the actor (v2 addition)
}
export interface CardAssigneeRemovedEvent
  extends DomainEvent<"card.assignee_removed", CardAssigneeRemovedPayload> {}

// ============================================================================
// 9. Card Due Date Updated  (Phase 1.2 — F1.2.2 — schemaVersion 2)
// ============================================================================
// v1 (pre-F1.2.2 stub) — never emitted to the outbox because the previous
// router stored due dates in `cards.accounting_data` JSONB without going
// through the outbox pipeline. The migration to v2 therefore has no
// backward-compatible payload to support; consumers should hard-require
// schemaVersion 2 fields.
//
// v2 payload
//   • oldDueDate: the `DateOnly | null` value the card carried before
//     the mutation. Useful for the activity timeline to render
//     "changed from 1404/01/01 to 1404/01/15" without re-reading
//     historical state.
//   • newDueDate: the `DateOnly | null` value after the mutation. null
//     means the user cleared the due date.
//   • updatedBy: the actor's user id. Mirrors the `appliedBy` /
//     `createdBy` convention from F1.2.1 events.
//
// Wire format: plain `string | null` (the brand erases over the wire).
// `YYYY-MM-DD` for set, null for cleared.
export interface CardDueDateUpdatedPayload {
  readonly cardId: string;
  readonly boardId: string;
  /** Previous due date in YYYY-MM-DD format, or null if the card had none. */
  readonly oldDueDate: string | null;
  /** New due date in YYYY-MM-DD format, or null if the user cleared it. */
  readonly newDueDate: string | null;
  /** UserId of the actor that performed the mutation. */
  readonly updatedBy: string;
}
export interface CardDueDateUpdatedEvent
  extends DomainEvent<"card.due_date_updated", CardDueDateUpdatedPayload> {}

// ============================================================================
// Aggregate Type Export
// ============================================================================
export type CardEvent =
  | CardMovedEvent
  | CardCreatedEvent
  | CardUpdatedEvent
  | CardDeletedEvent
  | CardLockedEvent
  | CardUnlockedEvent
  | CardAssigneeAddedEvent
  | CardAssigneeRemovedEvent
  | CardDueDateUpdatedEvent;
