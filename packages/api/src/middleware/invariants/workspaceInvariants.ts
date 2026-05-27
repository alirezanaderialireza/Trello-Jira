// packages/api/src/middleware/invariants/workspaceInvariants.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Pure invariant assertions for workspace membership mutations.
//
// Each function takes already-fetched state (caller's role, target's role,
// owner count, …) and either returns void or throws a typed error from
// `./errors`. No I/O. No DB. No side effects. Purposely callable from the
// command/use-case layer (not a tRPC middleware) so the same invariant
// runs both for tRPC mutations and any future Server Action that bypasses
// the middleware chain.
//
// The naming mirrors the conventional `assert*` form rather than `can*`.
// `assert*` plays nicely with TRPCError mapping at the call site
// (one-liner: `assertCanRemoveMember(...)`) and produces specific, typed
// failures rather than booleans that lose context.
//
// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANT — keep the role-transition matrix in sync with:
//   • workspace_members CHECK in migration 0003_workspace_role_check.sql
//   • WORKSPACE_ROLES in packages/domain/src/workspaces/index.ts
//   • Any router using one of these assertions
//
// If a new role appears (say "BILLING_ADMIN"), each function below must
// be revisited — the static `OWNER`/`ADMIN`/`MEMBER`/`VIEWER` checks here
// will not auto-handle it.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  WorkspaceRole,
  WorkspaceEntity,
} from "@repo/domain/workspaces";

import {
  AdminCannotRemoveOwnerError,
  InsufficientRoleError,
  LastOwnerCannotLeaveError,
  PersonalWorkspaceCannotBeDeletedError,
  TransfereeMustBeMemberError,
} from "./errors";

// ─── Helpers (intentionally not exported — these are implementation detail) ──

function isManagerRole(role: WorkspaceRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

// ────────────────────────────────────────────────────────────────────────────
// 1. assertCanInviteToWorkspace(callerRole)
//
//   OWNER and ADMIN can invite. MEMBER and VIEWER cannot.
//   Throws InsufficientRoleError("ADMIN") on denial.
// ────────────────────────────────────────────────────────────────────────────

export function assertCanInviteToWorkspace(callerRole: WorkspaceRole): void {
  if (!isManagerRole(callerRole)) {
    throw new InsufficientRoleError("ADMIN");
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 2. assertCanRemoveMember(callerRole, targetRole, ownerCount)
//
//   • caller must be OWNER/ADMIN
//   • ADMIN cannot remove an OWNER
//   • the last OWNER cannot be removed (would leave the workspace ownerless)
//
//   `ownerCount` counts only OWNER members (caller is responsible for
//   computing it via repository.getMemberCount(workspaceId, "OWNER")).
//   `targetRole` is the role of the member being removed; if removing
//   self, the caller passes their own role here too.
// ────────────────────────────────────────────────────────────────────────────

export function assertCanRemoveMember(
  callerRole: WorkspaceRole,
  targetRole: WorkspaceRole,
  ownerCount: number,
): void {
  if (!isManagerRole(callerRole)) {
    throw new InsufficientRoleError("ADMIN");
  }
  if (callerRole === "ADMIN" && targetRole === "OWNER") {
    throw new AdminCannotRemoveOwnerError();
  }
  if (targetRole === "OWNER" && ownerCount <= 1) {
    throw new LastOwnerCannotLeaveError();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 3. assertCanChangeMemberRole(callerRole, targetRole, newRole, ownerCount)
//
//   The most subtle invariant. Three rules, in order:
//
//     a. caller must be OWNER/ADMIN
//     b. ADMIN cannot demote an OWNER nor promote anyone to OWNER
//        (only OWNER can manage other OWNERs)
//     c. demoting the last OWNER (changing OWNER→non-OWNER when only
//        one OWNER remains) is blocked
//
//   No-op same-role transitions (e.g. MEMBER→MEMBER) are allowed and
//   silently succeed; the router is responsible for the idempotency
//   check if it cares.
// ────────────────────────────────────────────────────────────────────────────

export function assertCanChangeMemberRole(
  callerRole: WorkspaceRole,
  targetRole: WorkspaceRole,
  newRole: WorkspaceRole,
  ownerCount: number,
): void {
  if (!isManagerRole(callerRole)) {
    throw new InsufficientRoleError("ADMIN");
  }
  if (callerRole === "ADMIN" && targetRole === "OWNER") {
    throw new AdminCannotRemoveOwnerError();
  }
  if (callerRole === "ADMIN" && newRole === "OWNER") {
    throw new InsufficientRoleError("OWNER");
  }
  if (targetRole === "OWNER" && newRole !== "OWNER" && ownerCount <= 1) {
    throw new LastOwnerCannotLeaveError();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 4. assertCanLeaveWorkspace(callerRole, ownerCount)
//
//   Anyone can leave a workspace, EXCEPT the last OWNER. The last OWNER
//   must transfer ownership first, then leave (or be removed).
// ────────────────────────────────────────────────────────────────────────────

export function assertCanLeaveWorkspace(
  callerRole: WorkspaceRole,
  ownerCount: number,
): void {
  if (callerRole === "OWNER" && ownerCount <= 1) {
    throw new LastOwnerCannotLeaveError();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 5. assertCanTransferOwnership(callerRole, transfereeIsMember)
//
//   • caller must be OWNER (only OWNER can transfer)
//   • transferee must already be a member of the workspace
//
//   `transfereeIsMember` is a precomputed boolean from the caller (one
//   query: repository.getMembers(...).some(m => m.userId === transfereeId)).
//   Returning a boolean here keeps this function pure and DB-free.
// ────────────────────────────────────────────────────────────────────────────

export function assertCanTransferOwnership(
  callerRole: WorkspaceRole,
  transfereeIsMember: boolean,
): void {
  if (callerRole !== "OWNER") {
    throw new InsufficientRoleError("OWNER");
  }
  if (!transfereeIsMember) {
    throw new TransfereeMustBeMemberError();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 6. assertCanDeleteWorkspace(callerRole, workspace)
//
//   • caller must be OWNER
//   • personal workspaces (workspace.personalForUserId !== null) cannot be
//     deleted — they vanish with the user account, not via this flow
//
//   The argument is `Pick<WorkspaceEntity, "personalForUserId">` rather
//   than the full entity so callers can pass thin shapes (e.g. a SELECT
//   that only fetched the relevant column).
// ────────────────────────────────────────────────────────────────────────────

export function assertCanDeleteWorkspace(
  callerRole: WorkspaceRole,
  workspace: Pick<WorkspaceEntity, "personalForUserId">,
): void {
  if (callerRole !== "OWNER") {
    throw new InsufficientRoleError("OWNER");
  }
  if (workspace.personalForUserId !== null) {
    throw new PersonalWorkspaceCannotBeDeletedError();
  }
}
