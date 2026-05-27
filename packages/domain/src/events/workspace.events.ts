// packages/domain/src/events/workspace.events.ts
//
// Workspace-aggregate domain events (F3a.1).
//
// Naming convention: `workspace.<verb>` for events targeting the workspace
// itself. Sub-resource events (member.*, invitation.*) live in F3a.2 / F3a.3
// and follow the `workspace.<sub>.<verb>` shape — see `base.ts` notes.
//
// Payload guideline:
//   • Carry the minimum state diff needed for downstream subscribers (audit,
//     realtime patch fanout, search reindex). NEVER ship the full entity —
//     it bloats outbox rows and creates schema-coupling between writers and
//     readers.
//   • Background data is intentionally elided from `BackgroundChangedPayload`
//     because the JSONB column can be large and the change set is rarely
//     interesting outside the workspace itself. Subscribers that care can
//     refetch.

import type { DomainEvent } from "./base";

// ── Workspace.Created ───────────────────────────────────────────────────────

export interface WorkspaceCreatedPayload {
  readonly workspaceId: string;
  readonly slug: string;
  readonly name: string;
  readonly ownerId: string;
  readonly tier: "free" | "pro" | "enterprise";
}
export interface WorkspaceCreatedEvent
  extends DomainEvent<"workspace.created", WorkspaceCreatedPayload> {}

// ── Workspace.Updated ───────────────────────────────────────────────────────
//
// `fieldsChanged` lets subscribers (e.g. a search-index updater) decide
// whether they need to refetch — they don't need to know the new values
// inline, only that *something* changed.

export interface WorkspaceUpdatedPayload {
  readonly workspaceId: string;
  readonly fieldsChanged: ReadonlyArray<"name" | "description" | "slug">;
  readonly updatedBy: string;
}
export interface WorkspaceUpdatedEvent
  extends DomainEvent<"workspace.updated", WorkspaceUpdatedPayload> {}

// ── Workspace.SoftDeleted ───────────────────────────────────────────────────

export interface WorkspaceSoftDeletedPayload {
  readonly workspaceId: string;
  readonly deletedAt: string; // ISO-8601 UTC
  readonly deletedBy: string;
}
export interface WorkspaceSoftDeletedEvent
  extends DomainEvent<"workspace.soft_deleted", WorkspaceSoftDeletedPayload> {}

// ── Workspace.Restored ──────────────────────────────────────────────────────

export interface WorkspaceRestoredPayload {
  readonly workspaceId: string;
  readonly restoredAt: string; // ISO-8601 UTC
  readonly restoredBy: string;
}
export interface WorkspaceRestoredEvent
  extends DomainEvent<"workspace.restored", WorkspaceRestoredPayload> {}

// ── Workspace.BackgroundChanged ─────────────────────────────────────────────
//
// Intentionally light — JSONB diffs are noisy and subscribers can refetch
// from `workspaces.background_data` if they care.

export interface WorkspaceBackgroundChangedPayload {
  readonly workspaceId: string;
  readonly changedBy: string;
}
export interface WorkspaceBackgroundChangedEvent
  extends DomainEvent<"workspace.background_changed", WorkspaceBackgroundChangedPayload> {}

// ── Workspace.VisibilityChanged ─────────────────────────────────────────────

export interface WorkspaceVisibilityChangedPayload {
  readonly workspaceId: string;
  readonly from: "private" | "public";
  readonly to: "private" | "public";
  readonly changedBy: string;
}
export interface WorkspaceVisibilityChangedEvent
  extends DomainEvent<"workspace.visibility_changed", WorkspaceVisibilityChangedPayload> {}

// ── Workspace.Member.* events (F3a.2) ───────────────────────────────────────
//
// Membership events live under the workspace aggregate (the membership row
// IS a fact OF that workspace), so `aggregateType: "workspace"` and
// `aggregateId: workspaceId` for all four. The `userId` of the affected
// member lives in the payload.

import type { WorkspaceRole } from "../workspaces";

export interface WorkspaceMemberRoleUpdatedPayload {
  readonly workspaceId: string;
  readonly userId: string;
  readonly fromRole: WorkspaceRole;
  readonly toRole: WorkspaceRole;
  readonly changedBy: string;
}
export interface WorkspaceMemberRoleUpdatedEvent
  extends DomainEvent<"workspace.member.role_updated", WorkspaceMemberRoleUpdatedPayload> {}

export interface WorkspaceMemberRemovedPayload {
  readonly workspaceId: string;
  readonly userId: string;
  readonly removedBy: string;
}
export interface WorkspaceMemberRemovedEvent
  extends DomainEvent<"workspace.member.removed", WorkspaceMemberRemovedPayload> {}

export interface WorkspaceMemberLeftPayload {
  readonly workspaceId: string;
  readonly userId: string;
}
export interface WorkspaceMemberLeftEvent
  extends DomainEvent<"workspace.member.left", WorkspaceMemberLeftPayload> {}

export interface WorkspaceMemberOwnershipTransferredPayload {
  readonly workspaceId: string;
  readonly fromUserId: string;
  readonly toUserId: string;
}
export interface WorkspaceMemberOwnershipTransferredEvent
  extends DomainEvent<
    "workspace.member.ownership_transferred",
    WorkspaceMemberOwnershipTransferredPayload
  > {}

// ── Workspace.Member.Added (F3a.3) ──────────────────────────────────────────
//
// Emitted when a user becomes a member of a workspace, regardless of the
// join path (invitation accept, admin direct-add in the future, SCIM sync,
// etc.). Consumers that care about HOW the join happened should subscribe to
// the more specific `workspace.invitation.accepted` event.

export interface WorkspaceMemberAddedPayload {
  readonly workspaceId: string;
  readonly userId: string;
  readonly role: WorkspaceRole;
  readonly addedBy: string; // actorId that triggered the addition
}
export interface WorkspaceMemberAddedEvent
  extends DomainEvent<"workspace.member.added", WorkspaceMemberAddedPayload> {}

// ── Workspace.Invitation.* events (F3a.3) ──────────────────────────────────
//
// Token-based invitation lifecycle events. `aggregateType: "workspace"`,
// `aggregateId: workspaceId` — the invitation is a sub-resource of the
// workspace aggregate.

export interface WorkspaceInvitationCreatedPayload {
  readonly workspaceId: string;
  readonly invitationId: string;
  readonly invitedEmail: string; // normalized, lowercase
  readonly role: WorkspaceRole;
  readonly invitedBy: string;
  readonly expiresAt: string; // ISO-8601 UTC
}
export interface WorkspaceInvitationCreatedEvent
  extends DomainEvent<"workspace.invitation.created", WorkspaceInvitationCreatedPayload> {}

export interface WorkspaceInvitationRevokedPayload {
  readonly workspaceId: string;
  readonly invitationId: string;
  readonly revokedBy: string;
}
export interface WorkspaceInvitationRevokedEvent
  extends DomainEvent<"workspace.invitation.revoked", WorkspaceInvitationRevokedPayload> {}

export interface WorkspaceInvitationAcceptedPayload {
  readonly workspaceId: string;
  readonly invitationId: string;
  readonly acceptedByUserId: string;
  readonly role: WorkspaceRole;
}
export interface WorkspaceInvitationAcceptedEvent
  extends DomainEvent<"workspace.invitation.accepted", WorkspaceInvitationAcceptedPayload> {}

// ── Discriminated Union ─────────────────────────────────────────────────────

export type WorkspaceEvent =
  | WorkspaceCreatedEvent
  | WorkspaceUpdatedEvent
  | WorkspaceSoftDeletedEvent
  | WorkspaceRestoredEvent
  | WorkspaceBackgroundChangedEvent
  | WorkspaceVisibilityChangedEvent
  | WorkspaceMemberRoleUpdatedEvent
  | WorkspaceMemberRemovedEvent
  | WorkspaceMemberLeftEvent
  | WorkspaceMemberOwnershipTransferredEvent
  | WorkspaceMemberAddedEvent
  | WorkspaceInvitationCreatedEvent
  | WorkspaceInvitationRevokedEvent
  | WorkspaceInvitationAcceptedEvent;
