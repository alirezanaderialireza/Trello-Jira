// packages/domain/src/events/label.events.ts
//
// Phase 1.2 (F1.2.1) — label event payloads, schema version 2.
//
// v2 vs v1 deltas:
//   LabelCreatedPayload    : color → colorToken; +position; +createdBy
//   LabelUpdatedPayload    : changes.color → changes.colorToken;
//                            +changes.position
//   LabelDeletedPayload    : +affectedCardCount
//   CardLabelAddedPayload  : +appliedBy
//   CardLabelRemovedPayload: unchanged
//
// Event TYPE strings (`label.created`, `card.label_added`, …) are
// preserved from v1 — they match the project-wide snake_case verb
// convention for sub-resource events, the dispatcher already handles
// them, and existing reducers / mutation hooks key off them. Only the
// payload shape was bumped (D13 decision).
//
// Wire-level fields are plain `string`s, not branded types — branded IDs
// live on the LabelEntity / CardLabelLink models and are reapplied at
// the repository boundary.

import type { DomainEvent } from "./base";

// ============================================================================
// 1. Label Created
// ============================================================================

export interface LabelCreatedPayload {
  readonly labelId:    string;
  readonly boardId:    string;
  readonly name:       string;
  readonly colorToken: string;
  readonly position:   string;
  readonly createdBy:  string;
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
    readonly name?:       string;
    readonly colorToken?: string;
    readonly position?:   string;
  };
}
export interface LabelUpdatedEvent
  extends DomainEvent<"label.updated", LabelUpdatedPayload> {}

// ============================================================================
// 3. Label Deleted
// ============================================================================
// `affectedCardCount` is the number of card_labels rows hard-deleted in
// the same transaction; surfaced in the activity timeline and the
// rollback toast for confirmation.

export interface LabelDeletedPayload {
  readonly labelId:           string;
  readonly boardId:           string;
  readonly affectedCardCount: number;
}
export interface LabelDeletedEvent
  extends DomainEvent<"label.deleted", LabelDeletedPayload> {}

// ============================================================================
// 4. Card Label Added  (card-aggregate event, snake_case verb retained)
// ============================================================================

export interface CardLabelAddedPayload {
  readonly cardId:    string;
  readonly boardId:   string;
  readonly labelId:   string;
  readonly appliedBy: string;
}
export interface CardLabelAddedEvent
  extends DomainEvent<"card.label_added", CardLabelAddedPayload> {}

// ============================================================================
// 5. Card Label Removed
// ============================================================================

export interface CardLabelRemovedPayload {
  readonly cardId:  string;
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
