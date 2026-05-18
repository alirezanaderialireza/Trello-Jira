// packages/domain/src/events/card.events.ts
//
// Fixes applied:
// ✅ #D-09: CardUpdatedPayload.changes.description was typed as string? (optional).
//           Card.description is string | null in the domain model.
//           A reducer receiving CardUpdatedEvent needs to handle null explicitly
//           (e.g. clearing a description). string | null | undefined covers both
//           "not changed" (undefined) and "cleared" (null).
//
// ✅ #D-10: CardMovedPayload.oldPosition was included but the move-card domain
//           service and board.service.ts outbox payload don't produce oldPosition.
//           The field is optional to stay backward-compatible with any client
//           that might produce it, but not required.

import type { DomainEvent } from "./base";

// ============================================================================
// 1. Card Moved
// ============================================================================
export interface CardMovedPayload {
  readonly cardId:      string;
  readonly fromListId:  string;
  readonly toListId:    string;
  // ✅ #D-10: oldPosition is optional — domain service doesn't always produce it
  readonly oldPosition?: string;
  readonly newPosition: string;
  readonly boardId:     string;
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
  readonly cardId:  string;
  readonly boardId: string;
  readonly changes: {
    readonly title?:       string;
    // ✅ #D-09: null means "description cleared"; undefined means "not changed"
    readonly description?: string | null;
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