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

export interface CardMovedEvent extends DomainEvent<"card.moved", CardMovedPayload> {}

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

export interface CardCreatedEvent extends DomainEvent<"card.created", CardCreatedPayload> {}

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

export interface CardUpdatedEvent extends DomainEvent<"card.updated", CardUpdatedPayload> {}

// ============================================================================
// 4. Card Deleted (برای کامل شدن سیکل CRUD)
// ============================================================================
export interface CardDeletedPayload {
  readonly cardId: string;
  readonly boardId: string;
}

export interface CardDeletedEvent extends DomainEvent<"card.deleted", CardDeletedPayload> {}

// ============================================================================
// Aggregate Type Export
// ============================================================================
export type CardEvent = 
  | CardMovedEvent 
  | CardCreatedEvent 
  | CardUpdatedEvent
  | CardDeletedEvent;