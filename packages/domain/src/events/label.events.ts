// packages/domain/src/events/label.events.ts
import type { DomainEvent } from "./base";

// ============================================================================
// 1. Label Created
// ============================================================================
export interface LabelCreatedPayload {
  readonly labelId: string;
  readonly boardId: string;
  readonly name: string;
  readonly color: string;
}
export interface LabelCreatedEvent
  extends DomainEvent<"label.created", LabelCreatedPayload> {}

// ============================================================================
// 2. Label Updated
// ============================================================================
export interface LabelUpdatedPayload {
  readonly labelId: string;
  readonly boardId: string;
  readonly changes: {
    readonly name?: string;
    readonly color?: string;
  };
}
export interface LabelUpdatedEvent
  extends DomainEvent<"label.updated", LabelUpdatedPayload> {}

// ============================================================================
// 3. Label Deleted
// ============================================================================
export interface LabelDeletedPayload {
  readonly labelId: string;
  readonly boardId: string;
}
export interface LabelDeletedEvent
  extends DomainEvent<"label.deleted", LabelDeletedPayload> {}

// ============================================================================
// 4. Card Label Added  (card-scoped but label-aggregate event)
// ============================================================================
export interface CardLabelAddedPayload {
  readonly cardId: string;
  readonly boardId: string;
  readonly labelId: string;
}
export interface CardLabelAddedEvent
  extends DomainEvent<"card.label_added", CardLabelAddedPayload> {}

// ============================================================================
// 5. Card Label Removed
// ============================================================================
export interface CardLabelRemovedPayload {
  readonly cardId: string;
  readonly boardId: string;
  readonly labelId: string;
}
export interface CardLabelRemovedEvent
  extends DomainEvent<"card.label_removed", CardLabelRemovedPayload> {}

// ============================================================================
// Aggregate Type Export
// ============================================================================
export type LabelEvent =
  | LabelCreatedEvent
  | LabelUpdatedEvent
  | LabelDeletedEvent
  | CardLabelAddedEvent
  | CardLabelRemovedEvent;
