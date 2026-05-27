// packages/domain/src/workspaces/use-cases/transferOwnership.ts
//
// Pure-domain use case: validate workspace ownership transfer.
//
// Why this exists at all:
//   • Ownership transfer mutates THREE rows (current-owner membership,
//     new-owner membership, workspaces.owner_id pointer). Pre-F3a.2 the
//     router did this WITHOUT a transaction — partial failure left the
//     workspace ownerless, which is the bug flagged on PR #50.
//   • The validation rules (no self-transfer; new owner must already be a
//     member; new owner cannot already be OWNER) belong in the domain so
//     they can be unit-tested without a tRPC pipeline + DB.
//
// What this is NOT:
//   • It does NOT perform any I/O. The router still does the three writes
//     itself — but inside `ctx.runInTenantTx(...)` so they commit
//     atomically. This use case only tells the router whether to proceed
//     and what the next roles will be.
//   • It does NOT know about the F2 `workspaceOwnerProcedure` builder
//     (which guards "caller is OWNER"). That guard must run BEFORE this
//     use case is called.

import type { WorkspaceRole } from "../index";

export interface TransferOwnershipCommand {
  /** UUID of the user issuing the transfer (already verified OWNER by the F2 builder). */
  readonly currentOwnerUserId: string;
  /** UUID of the user receiving ownership. */
  readonly newOwnerUserId: string;
  /**
   * Current role of newOwnerUserId in the workspace.
   * `null` means the new-owner candidate is not a member at all — the
   * transfer is then rejected so callers don't accidentally invite a
   * stranger by raising them to OWNER.
   */
  readonly newOwnerCurrentRole: WorkspaceRole | null;
}

export type TransferOwnershipFailureReason =
  | "SELF_TRANSFER"
  | "NEW_OWNER_NOT_MEMBER"
  | "NEW_OWNER_ALREADY_OWNER";

export type TransferOwnershipResult =
  | { readonly success: false; readonly reason: TransferOwnershipFailureReason }
  | {
      readonly success: true;
      /** Role the current owner is demoted to. ADMIN by convention. */
      readonly currentOwnerNextRole: "ADMIN";
      /** Role the new owner is promoted to. */
      readonly newOwnerNextRole: "OWNER";
    };

export function transferOwnership(
  cmd: TransferOwnershipCommand,
): TransferOwnershipResult {
  if (cmd.currentOwnerUserId === cmd.newOwnerUserId) {
    return { success: false, reason: "SELF_TRANSFER" };
  }
  if (cmd.newOwnerCurrentRole === null) {
    return { success: false, reason: "NEW_OWNER_NOT_MEMBER" };
  }
  if (cmd.newOwnerCurrentRole === "OWNER") {
    // Defensive: the workspaceOwnerProcedure should have given us the
    // current OWNER as `currentOwnerUserId`, so the new candidate cannot
    // also be OWNER (only one OWNER exists). But if data ever drifts —
    // e.g. a half-applied transfer from a pre-F3a.2 deployment — this
    // catches it before we'd produce two OWNERs.
    return { success: false, reason: "NEW_OWNER_ALREADY_OWNER" };
  }

  return {
    success: true,
    currentOwnerNextRole: "ADMIN",
    newOwnerNextRole: "OWNER",
  };
}
