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
// 7. Card Assignee Added
// ============================================================================
export interface CardAssigneeAddedPayload {
  readonly cardId: string;
  readonly boardId: string;
  readonly assigneeId: string; // userId
}
export interface CardAssigneeAddedEvent
  extends DomainEvent<"card.assignee_added", CardAssigneeAddedPayload> {}

// ============================================================================
// 8. Card Assignee Removed
// ============================================================================
export interface CardAssigneeRemovedPayload {
  readonly cardId: string;
  readonly boardId: string;
  readonly assigneeId: string; // userId
}
export interface CardAssigneeRemovedEvent
  extends DomainEvent<"card.assignee_removed", CardAssigneeRemovedPayload> {}

// ============================================================================
// 9. Card Due Date Updated
// ============================================================================
export interface CardDueDateUpdatedPayload {
  readonly cardId: string;
  readonly boardId: string;
  /** null = due date cleared */
  readonly dueDate: string | null; // ISO-8601 UTC or null
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
