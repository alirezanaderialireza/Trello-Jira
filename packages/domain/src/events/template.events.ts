// packages/domain/src/events/template.events.ts
import type { DomainEvent } from "./base";

// ============================================================================
// Shared: lightweight structure snapshot (avoids importing store DTOs here)
// ============================================================================
export interface TemplateListShape {
  readonly id: string;
  readonly title: string;
  readonly position: string;
}

export interface TemplateCardShape {
  readonly id: string;
  readonly title: string;
  readonly position: string;
  readonly listId: string;
  readonly description?: string;
}

export interface TemplateStructure {
  readonly lists: readonly TemplateListShape[];
  readonly cards: readonly TemplateCardShape[];
}

// ============================================================================
// 1. Template Created
// ============================================================================
export interface TemplateCreatedPayload {
  readonly templateId: string;
  readonly boardId: string;
  readonly name: string;
  readonly description?: string;
  readonly structure: TemplateStructure;
  readonly createdAt: string;
}
export interface TemplateCreatedEvent
  extends DomainEvent<"template.created", TemplateCreatedPayload> {}

// ============================================================================
// 2. Template Updated
// ============================================================================
export interface TemplateUpdatedPayload {
  readonly templateId: string;
  readonly boardId: string;
  readonly changes: {
    readonly name?: string;
    readonly description?: string;
    readonly structure?: TemplateStructure;
  };
  readonly updatedAt: string;
}
export interface TemplateUpdatedEvent
  extends DomainEvent<"template.updated", TemplateUpdatedPayload> {}

// ============================================================================
// 3. Template Deleted
// ============================================================================
export interface TemplateDeletedPayload {
  readonly templateId: string;
  readonly boardId: string;
}
export interface TemplateDeletedEvent
  extends DomainEvent<"template.deleted", TemplateDeletedPayload> {}

// ============================================================================
// 4. Template Applied  (board was hydrated from a template)
// ============================================================================
export interface TemplateAppliedPayload {
  readonly templateId: string;
  readonly boardId: string;
  /** IDs of newly-created lists after apply. */
  readonly createdListIds: readonly string[];
  /** IDs of newly-created cards after apply. */
  readonly createdCardIds: readonly string[];
  readonly appliedAt: string;
}
export interface TemplateAppliedEvent
  extends DomainEvent<"template.applied", TemplateAppliedPayload> {}

// ============================================================================
// Aggregate Type Export
// ============================================================================
export type TemplateEvent =
  | TemplateCreatedEvent
  | TemplateUpdatedEvent
  | TemplateDeletedEvent
  | TemplateAppliedEvent;
