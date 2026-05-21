// packages/domain/src/events/checklist.events.ts
import type { DomainEvent } from "./base";

// ============================================================================
// Shared: ChecklistItem shape (readonly, inline — no external DTO dependency)
// ============================================================================
export interface ChecklistItemPayload {
  readonly id: string;
  readonly title: string;
  readonly completed: boolean;
}

// ============================================================================
// 1. Checklist Created
// ============================================================================
export interface ChecklistCreatedPayload {
  readonly checklistId: string;
  readonly cardId: string;
  readonly boardId: string;
  readonly name: string;
  /** Initial items — may be empty on creation. */
  readonly items: readonly ChecklistItemPayload[];
}
export interface ChecklistCreatedEvent
  extends DomainEvent<"checklist.created", ChecklistCreatedPayload> {}

// ============================================================================
// 2. Checklist Item Added
// ============================================================================
export interface ChecklistItemAddedPayload {
  readonly checklistId: string;
  readonly cardId: string;
  readonly boardId: string;
  readonly item: ChecklistItemPayload;
}
export interface ChecklistItemAddedEvent
  extends DomainEvent<"checklist.item_added", ChecklistItemAddedPayload> {}

// ============================================================================
// 3. Checklist Item Updated
// ============================================================================
export interface ChecklistItemUpdatedPayload {
  readonly checklistId: string;
  readonly cardId: string;
  readonly boardId: string;
  readonly itemId: string;
  readonly changes: {
    readonly title?: string;
    readonly completed?: boolean;
  };
}
export interface ChecklistItemUpdatedEvent
  extends DomainEvent<"checklist.item_updated", ChecklistItemUpdatedPayload> {}

// ============================================================================
// 4. Checklist Item Removed
// ============================================================================
export interface ChecklistItemRemovedPayload {
  readonly checklistId: string;
  readonly cardId: string;
  readonly boardId: string;
  readonly itemId: string;
}
export interface ChecklistItemRemovedEvent
  extends DomainEvent<"checklist.item_removed", ChecklistItemRemovedPayload> {}

// ============================================================================
// 5. Checklist Deleted
// ============================================================================
export interface ChecklistDeletedPayload {
  readonly checklistId: string;
  readonly cardId: string;
  readonly boardId: string;
}
export interface ChecklistDeletedEvent
  extends DomainEvent<"checklist.deleted", ChecklistDeletedPayload> {}

// ============================================================================
// Aggregate Type Export
// ============================================================================
export type ChecklistEvent =
  | ChecklistCreatedEvent
  | ChecklistItemAddedEvent
  | ChecklistItemUpdatedEvent
  | ChecklistItemRemovedEvent
  | ChecklistDeletedEvent;
