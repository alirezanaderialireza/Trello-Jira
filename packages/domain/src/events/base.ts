// packages/domain/src/events/base.ts

/**
 * Every legal event type string in the system.
 * Add new entries here before creating the corresponding event interface.
 */
export type DomainEventType =
  // ── Card ────────────────────────────────────────────────────────────────
  | "card.created"
  | "card.moved"
  | "card.updated"
  | "card.deleted"
  | "card.locked"
  | "card.unlocked"
  | "card.assignee_added"
  | "card.assignee_removed"
  | "card.due_date_updated"
  | "card.label_added"
  | "card.label_removed"
  // ── List ────────────────────────────────────────────────────────────────
  | "list.created"
  | "list.moved"
  | "list.updated"
  | "list.deleted"
  // ── Board ───────────────────────────────────────────────────────────────
  | "board.created"
  | "board.renamed"
  | "board.archived"
  | "board.unarchived"
  | "board.visibility_changed"
  // ── Label ───────────────────────────────────────────────────────────────
  | "label.created"
  | "label.updated"
  | "label.deleted"
  // ── Checklist ───────────────────────────────────────────────────────────
  | "checklist.created"
  | "checklist.item_added"
  | "checklist.item_updated"
  | "checklist.item_removed"
  | "checklist.deleted"
  // ── Comment ─────────────────────────────────────────────────────────────
  | "comment.created"
  | "comment.updated"
  | "comment.deleted"
  // ── Attachment ──────────────────────────────────────────────────────────
  | "attachment.added"
  | "attachment.removed"
  // ── Template ────────────────────────────────────────────────────────────
  | "template.created"
  | "template.updated"
  | "template.deleted"
  | "template.applied"
  // ── Activity (internal projection event) ────────────────────────────────
  | "activity.recorded";

export type AggregateType =
  | "board"
  | "list"
  | "card"
  | "label"
  | "checklist"
  | "comment"
  | "attachment"
  | "template"
  | "activity";

/**
 * ------------------------------------------------------------------
 * The Canonical Domain Event Base (Production-Grade)
 * ------------------------------------------------------------------
 * All events in the system extend this interface.
 * No event may travel through the system without satisfying this contract.
 * ------------------------------------------------------------------
 */
export interface DomainEvent<
  TType extends DomainEventType = DomainEventType,
  TPayload = unknown,
> {
  // ── Event Identification ─────────────────────────────────────────────────
  readonly id: string;
  readonly type: TType;

  // ── Ordering, Concurrency & Versioning ──────────────────────────────────
  /** Canonical aggregate version — single source of truth for stale protection. */
  readonly version: number;
  readonly occurredAt: string; // ISO-8601 UTC
  readonly schemaVersion?: number;

  // ── State Changes ────────────────────────────────────────────────────────
  readonly payload: Readonly<TPayload>;

  // ── Distributed System Metadata ──────────────────────────────────────────
  readonly aggregateId: string;
  readonly aggregateType: AggregateType;
  readonly sequence?: number;
  readonly actorId?: string;
  readonly tenantId?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
}
