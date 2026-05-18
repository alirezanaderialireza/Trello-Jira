// packages/domain/src/events/list.events.ts
import type { DomainEvent } from "./base";

// ============================================================================
// 1. List Moved
// ============================================================================
export interface ListMovedPayload {
  readonly listId: string;
  readonly boardId: string;
  readonly oldPosition: string;
  readonly newPosition: string;
}

export interface ListMovedEvent extends DomainEvent<"list.moved", ListMovedPayload> {}

// ============================================================================
// 2. List Created
// ============================================================================
export interface ListCreatedPayload {
  readonly listId: string;
  readonly boardId: string;
  readonly title: string;
  readonly position: string;
}

export interface ListCreatedEvent extends DomainEvent<"list.created", ListCreatedPayload> {}

// ============================================================================
// 3. List Updated
// ============================================================================
export interface ListUpdatedPayload {
  readonly listId: string;
  readonly boardId: string;
  readonly changes: {
    readonly title?: string;
  };
}

export interface ListUpdatedEvent extends DomainEvent<"list.updated", ListUpdatedPayload> {}

// ============================================================================
// 4. List Deleted (🌟 اضافه شده برای Phase 2.5)
// ============================================================================
export interface ListDeletedPayload {
  readonly listId: string;
  readonly boardId: string;
}

export interface ListDeletedEvent extends DomainEvent<"list.deleted", ListDeletedPayload> {}

// ============================================================================
// Aggregate Type Export
// ============================================================================
export type ListEvent = 
  | ListMovedEvent 
  | ListCreatedEvent 
  | ListUpdatedEvent
  | ListDeletedEvent;