// packages/domain/src/events/board.events.ts
//
// Board-aggregate domain events.
//
// F3b extends the original 5-event set with three lifecycle events
// (soft_deleted / restored / background_changed) and three member-sub-resource
// events (added / role_changed / removed). The member events follow the same
// pattern as `workspace.member.*` in F3a.2: aggregate is the parent (board)
// and the userId of the affected member lives in the payload.

import type { DomainEvent } from "./base";

// ── Original events (board.created → board.visibility_changed) ─────────────

export interface BoardCreatedPayload {
  readonly boardId: string;
  readonly title: string;
  readonly tenantId: string;
}
export interface BoardCreatedEvent extends DomainEvent<"board.created", BoardCreatedPayload> {}

export interface BoardRenamedPayload {
  readonly boardId: string;
  readonly title: string;
}
export interface BoardRenamedEvent extends DomainEvent<"board.renamed", BoardRenamedPayload> {}

export interface BoardArchivedPayload {
  readonly boardId: string;
  readonly archivedBy: string;
}
export interface BoardArchivedEvent extends DomainEvent<"board.archived", BoardArchivedPayload> {}

export interface BoardUnarchivedPayload {
  readonly boardId: string;
  readonly unarchivedBy: string;
}
export interface BoardUnarchivedEvent extends DomainEvent<"board.unarchived", BoardUnarchivedPayload> {}

export interface BoardVisibilityChangedPayload {
  readonly boardId: string;
  readonly from: "workspace" | "private" | "public";
  readonly to: "workspace" | "private" | "public";
  readonly changedBy: string;
}
export interface BoardVisibilityChangedEvent
  extends DomainEvent<"board.visibility_changed", BoardVisibilityChangedPayload> {}

// ── Lifecycle events (F3b) ──────────────────────────────────────────────────

export interface BoardSoftDeletedPayload {
  readonly boardId: string;
  readonly deletedAt: string; // ISO-8601 UTC
  readonly deletedBy: string;
}
export interface BoardSoftDeletedEvent
  extends DomainEvent<"board.soft_deleted", BoardSoftDeletedPayload> {}

export interface BoardRestoredPayload {
  readonly boardId: string;
  readonly restoredAt: string; // ISO-8601 UTC
  readonly restoredBy: string;
}
export interface BoardRestoredEvent
  extends DomainEvent<"board.restored", BoardRestoredPayload> {}

// JSONB diff intentionally elided — backgroundData can be large and
// subscribers can refetch from the row if they care. Mirrors
// WorkspaceBackgroundChangedPayload in F3a.1.
export interface BoardBackgroundChangedPayload {
  readonly boardId: string;
  readonly changedBy: string;
}
export interface BoardBackgroundChangedEvent
  extends DomainEvent<"board.background_changed", BoardBackgroundChangedPayload> {}

// ── Member events (F3b) ─────────────────────────────────────────────────────
//
// `BoardMemberRole` is a typed string at the API boundary (Zod enum
// "ADMIN" | "MEMBER" today; "OWNER" is reserved for the board creator
// and is only ever set inline by the createBoard handler). VIEWER is
// not yet exposed as an assignable role for boards.

export type BoardMemberRole = "OWNER" | "ADMIN" | "MEMBER";

export interface BoardMemberAddedPayload {
  readonly boardId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly role: BoardMemberRole;
  readonly addedBy: string;
  /**
   * `true` when the same user had a previously soft-removed membership row
   * that this call reactivated. Lets subscribers (audit, member-count
   * projections) tell a fresh add from a re-add without a separate event
   * type.
   */
  readonly wasReactivated: boolean;
}
export interface BoardMemberAddedEvent
  extends DomainEvent<"board.member.added", BoardMemberAddedPayload> {}

export interface BoardMemberRoleChangedPayload {
  readonly boardId: string;
  readonly userId: string;
  readonly fromRole: BoardMemberRole;
  readonly toRole: BoardMemberRole;
  readonly changedBy: string;
}
export interface BoardMemberRoleChangedEvent
  extends DomainEvent<"board.member.role_changed", BoardMemberRoleChangedPayload> {}

export interface BoardMemberRemovedPayload {
  readonly boardId: string;
  readonly userId: string;
  readonly removedBy: string;
}
export interface BoardMemberRemovedEvent
  extends DomainEvent<"board.member.removed", BoardMemberRemovedPayload> {}

// ── Discriminated Union ─────────────────────────────────────────────────────

export type BoardEvent =
  | BoardCreatedEvent
  | BoardRenamedEvent
  | BoardArchivedEvent
  | BoardUnarchivedEvent
  | BoardVisibilityChangedEvent
  | BoardSoftDeletedEvent
  | BoardRestoredEvent
  | BoardBackgroundChangedEvent
  | BoardMemberAddedEvent
  | BoardMemberRoleChangedEvent
  | BoardMemberRemovedEvent;
