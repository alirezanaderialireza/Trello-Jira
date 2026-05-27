// packages/domain/src/workspaces/use-cases/softDeleteWorkspace.ts
//
// Pure-domain use case: soft-delete a workspace.
//
// Responsibility: validate invariants and produce the next workspace state
// (with `deletedAt` set and `revision` bumped). NO I/O, NO transaction
// management, NO outbox writes — those happen in the API/router layer that
// composes this use case with the repository and the outbox.
//
// Invariants enforced here:
//   1. The workspace must not already be soft-deleted (otherwise the second
//      delete would race with a pending restore and corrupt the audit
//      trail).
//   2. Personal workspaces (those with `personalForUserId !== null`) cannot
//      be deleted — the existing domain rule from `index.ts`. Personal
//      workspaces are tied 1:1 with a user account; deletion happens via
//      account deletion only.
//
// The router is expected to wrap the call in a transaction:
//
//   const result = softDeleteWorkspace({ workspace, actorUserId, now });
//   if (!result.success) throw new TRPCError(...);
//   await ctx.runInTenantTx(async (tx) => {
//     await ctx.repos.workspace.softDelete(workspace.id, tx);
//     await ctx.repos.outbox.append(tx, { type: "workspace.soft_deleted", ... });
//   });

import type { WorkspaceEntity } from "../index";

export interface SoftDeleteWorkspaceCommand {
  /** The workspace to delete, as currently persisted. */
  readonly workspace: WorkspaceEntity;
  /** UUID of the user issuing the delete. Stamped into the event payload. */
  readonly actorUserId: string;
  /** Server-stamped timestamp. Pass `new Date()` from the caller; tests
   *  inject a fixed clock. */
  readonly now: Date;
}

export type SoftDeleteWorkspaceFailureReason =
  | "ALREADY_DELETED"
  | "PERSONAL_WORKSPACE";

export type SoftDeleteWorkspaceResult =
  | { readonly success: false; readonly reason: SoftDeleteWorkspaceFailureReason }
  | { readonly success: true; readonly nextWorkspace: WorkspaceEntity };

export function softDeleteWorkspace(
  cmd: SoftDeleteWorkspaceCommand,
): SoftDeleteWorkspaceResult {
  if (cmd.workspace.deletedAt !== null) {
    return { success: false, reason: "ALREADY_DELETED" };
  }

  if (cmd.workspace.personalForUserId !== null) {
    return { success: false, reason: "PERSONAL_WORKSPACE" };
  }

  return {
    success: true,
    nextWorkspace: {
      ...cmd.workspace,
      deletedAt: cmd.now,
      revision: cmd.workspace.revision + 1,
      updatedAt: cmd.now,
    },
  };
}
