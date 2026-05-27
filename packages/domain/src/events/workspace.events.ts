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

// ── Discriminated Union ─────────────────────────────────────────────────────

export type WorkspaceEvent =
  | WorkspaceCreatedEvent
  | WorkspaceUpdatedEvent
  | WorkspaceSoftDeletedEvent
  | WorkspaceRestoredEvent
  | WorkspaceBackgroundChangedEvent
  | WorkspaceVisibilityChangedEvent;
