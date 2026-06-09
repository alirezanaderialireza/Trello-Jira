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
  | "card.cover_updated"
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
  // ── Board lifecycle (F3b) ───────────────────────────────────────────────
  | "board.soft_deleted"
  | "board.restored"
  | "board.background_changed"
  | "board.description_updated"
  // ── Board members (F3b) ─────────────────────────────────────────────────
  // Naming convention mirrors `workspace.member.*` from F3a.2: the
  // membership row is a sub-resource of the board aggregate, so events
  // live under `aggregateType: "board"` with `aggregateId: boardId` and
  // the affected userId in the payload.
  | "board.member.added"
  | "board.member.role_changed"
  | "board.member.removed"
  // ── Label ───────────────────────────────────────────────────────────────
  | "label.created"
  | "label.updated"
  | "label.deleted"
  // ── Checklist ───────────────────────────────────────────────────────────
  | "checklist.created"
  | "checklist.updated"
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
  | "activity.recorded"
  // ── Workspace (F3a.1) ───────────────────────────────────────────────────
  // Convention: `workspace.<verb>` for the workspace aggregate itself,
  // `workspace.<sub>.<verb>` for sub-resources (member, invitation) — see
  // F3a.2/F3a.3. Multi-word verbs use snake_case to match the existing
  // event-type style (e.g. `board.visibility_changed`).
  | "workspace.created"
  | "workspace.updated"
  | "workspace.soft_deleted"
  | "workspace.restored"
  | "workspace.background_changed"
  | "workspace.visibility_changed"
  // ── Workspace.Member (F3a.2) ────────────────────────────────────────────
  // Sub-resource events still live under aggregateType "workspace" (the
  // membership row IS a workspace fact); only the type literal carries the
  // sub-resource hierarchy.
  | "workspace.member.role_updated"
  | "workspace.member.removed"
  | "workspace.member.left"
  | "workspace.member.ownership_transferred"
  | "workspace.member.added"
  // ── Workspace.Invitation (F3a.3) ─────────────────────────────────────────
  | "workspace.invitation.created"
  | "workspace.invitation.revoked"
  | "workspace.invitation.accepted";

export type AggregateType =
  | "board"
  | "list"
  | "card"
  | "label"
  | "checklist"
  | "comment"
  | "attachment"
  | "template"
  | "activity"
  | "workspace";

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
