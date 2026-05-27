// packages/domain/src/workspaces/use-cases/restoreWorkspace.ts
//
// Pure-domain use case: restore a soft-deleted workspace.
//
// Invariants enforced here:
//   1. The workspace MUST currently be soft-deleted (`deletedAt !== null`).
//      Restoring a live workspace is a no-op and surfaces as an error so the
//      caller can react explicitly.
//   2. Restoration is only permitted within a bounded recovery window from
//      `deletedAt`. After the window the workspace is eligible for hard
//      deletion (per F1's data lifecycle policy in steering/architecture.md)
//      and a restore would resurrect resources the user has been told are
//      gone.
//
// The window is parameterizable so tests can drive any boundary, and so a
// future ops console can override per-tier (enterprise = longer window).
// Default is 30 days, matching the F1 spec note ("Workspace soft-delete →
// hard delete after 30 days").
//
// As with `softDeleteWorkspace`, this is pure: no I/O, no outbox. The
// router composes it with the repository and emits `workspace.restored`.

import type { WorkspaceEntity } from "../index";

/** 30 days, in milliseconds. */
export const DEFAULT_RESTORE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface RestoreWorkspaceCommand {
  /** The workspace to restore, as currently persisted (must be soft-deleted). */
  readonly workspace: WorkspaceEntity;
  /** UUID of the user issuing the restore. Stamped into the event payload. */
  readonly actorUserId: string;
  /** Server-stamped timestamp. */
  readonly now: Date;
  /** Recovery window in milliseconds. Defaults to 30 days. */
  readonly windowMs?: number;
}

export type RestoreWorkspaceFailureReason =
  | "NOT_DELETED"
  | "RESTORE_WINDOW_EXPIRED";

export type RestoreWorkspaceResult =
  | { readonly success: false; readonly reason: RestoreWorkspaceFailureReason }
  | { readonly success: true; readonly nextWorkspace: WorkspaceEntity };

export function restoreWorkspace(
  cmd: RestoreWorkspaceCommand,
): RestoreWorkspaceResult {
  const window = cmd.windowMs ?? DEFAULT_RESTORE_WINDOW_MS;

  if (cmd.workspace.deletedAt === null) {
    return { success: false, reason: "NOT_DELETED" };
  }

  const elapsedMs = cmd.now.getTime() - cmd.workspace.deletedAt.getTime();
  if (elapsedMs > window) {
    return { success: false, reason: "RESTORE_WINDOW_EXPIRED" };
  }

  return {
    success: true,
    nextWorkspace: {
      ...cmd.workspace,
      deletedAt: null,
      revision: cmd.workspace.revision + 1,
      updatedAt: cmd.now,
    },
  };
}
