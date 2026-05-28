// packages/domain/src/events/checklist.events.ts
//
// Phase 1.2 (F1.2.3.a) — checklist event payloads, schema version 2.
//
// v2 vs v1 deltas
//   ChecklistCreatedPayload     : `name → title`; +createdBy; items
//                                 array dropped (initial items always
//                                 empty in F1.2.3.a — items are added
//                                 separately so each addition emits its
//                                 own event for the activity timeline).
//   ChecklistUpdatedPayload     : NEW (v1 didn't have it — F1.2.3.a
//                                 D12 adds reorder/rename via
//                                 updateChecklist).
//   ChecklistDeletedPayload     : +affectedItemCount (mirrors
//                                 labels.deleted's affectedCardCount).
//   ChecklistItemAddedPayload   : flattened `item` shape (text + isDone
//                                 + position + checklistItemId at the
//                                 root); +addedBy; +position.
//   ChecklistItemUpdatedPayload : `changes.title → changes.text`;
//                                 `changes.completed → changes.isDone`;
//                                 +changes.position (D11 reorder).
//   ChecklistItemRemovedPayload : unchanged shape, schemaVersion 2.
//
// Event TYPE strings stay snake_case-with-underscore between sub-
// resource and verb (`checklist.item_added` etc.) — same convention as
// F1.2.1's `card.label_added` and matching the existing client
// dispatcher / reducers, per Master Contract D8 and the F1.2.1 D13
// precedent.
//
// Wire format: plain `string`s — branded IDs live on the entity /
// repository boundary and re-apply at the DB layer.

import type { DomainEvent } from "./base";

// ============================================================================
// 1. Checklist Created
// ============================================================================

export interface ChecklistCreatedPayload {
  readonly checklistId: string;
  readonly cardId:      string;
  readonly boardId:     string;
  readonly title:       string;
  readonly position:    string;
  readonly createdBy:   string;
}
export interface ChecklistCreatedEvent
  extends DomainEvent<"checklist.created", ChecklistCreatedPayload> {}

// ============================================================================
// 2. Checklist Updated  (NEW in F1.2.3.a — D12 reorder + rename)
// ============================================================================

export interface ChecklistUpdatedPayload {
  readonly checklistId: string;
  readonly cardId:      string;
  readonly boardId:     string;
  readonly changes: {
    readonly title?:    string;
    readonly position?: string;
  };
}
export interface ChecklistUpdatedEvent
  extends DomainEvent<"checklist.updated", ChecklistUpdatedPayload> {}

// ============================================================================
// 3. Checklist Deleted
// ============================================================================

export interface ChecklistDeletedPayload {
  readonly checklistId:        string;
  readonly cardId:             string;
  readonly boardId:            string;
  readonly affectedItemCount:  number;
}
export interface ChecklistDeletedEvent
  extends DomainEvent<"checklist.deleted", ChecklistDeletedPayload> {}

// ============================================================================
// 4. Checklist Item Added  (snake_case verb retained)
// ============================================================================

export interface ChecklistItemAddedPayload {
  readonly checklistItemId: string;
  readonly checklistId:     string;
  readonly cardId:          string;
  readonly boardId:         string;
  readonly text:            string;
  readonly isDone:          boolean;
  readonly position:        string;
  readonly addedBy:         string;
}
export interface ChecklistItemAddedEvent
  extends DomainEvent<"checklist.item_added", ChecklistItemAddedPayload> {}

// ============================================================================
// 5. Checklist Item Updated
// ============================================================================

export interface ChecklistItemUpdatedPayload {
  readonly checklistItemId: string;
  readonly checklistId:     string;
  readonly cardId:          string;
  readonly boardId:         string;
  readonly changes: {
    readonly text?:     string;
    readonly isDone?:   boolean;
    readonly position?: string;
  };
}
export interface ChecklistItemUpdatedEvent
  extends DomainEvent<
      "checklist.item_updated",
      ChecklistItemUpdatedPayload
    > {}

// ============================================================================
// 6. Checklist Item Removed
// ============================================================================

export interface ChecklistItemRemovedPayload {
  readonly checklistItemId: string;
  readonly checklistId:     string;
  readonly cardId:          string;
  readonly boardId:         string;
}
export interface ChecklistItemRemovedEvent
  extends DomainEvent<
      "checklist.item_removed",
      ChecklistItemRemovedPayload
    > {}

// ============================================================================
// Aggregate Type Export
// ============================================================================

export type ChecklistEvent =
  | ChecklistCreatedEvent
  | ChecklistUpdatedEvent
  | ChecklistDeletedEvent
  | ChecklistItemAddedEvent
  | ChecklistItemUpdatedEvent
  | ChecklistItemRemovedEvent;
