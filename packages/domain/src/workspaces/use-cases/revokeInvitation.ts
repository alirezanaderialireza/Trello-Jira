// packages/domain/src/workspaces/use-cases/revokeInvitation.ts
//
// Pure domain use case: validate whether a workspace invitation can be
// revoked by an admin. No I/O — returns a Result discriminated union.
//
// Guards:
//   1. Invitation must exist (NOT_FOUND).
//   2. Must not already be accepted (ALREADY_ACCEPTED).
//   3. Must not already be revoked (ALREADY_REVOKED).

// ── Types ────────────────────────────────────────────────────────────────────

export interface RevokeInvitationCommand {
  /** The invitation row (or null if lookup returned nothing). */
  readonly invitation: RevokeInvitationRow | null;
}

export interface RevokeInvitationRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
}

// ── Result ───────────────────────────────────────────────────────────────────

export type RevokeInvitationFailureReason =
  | "NOT_FOUND"
  | "ALREADY_ACCEPTED"
  | "ALREADY_REVOKED";

export type RevokeInvitationResult =
  | { readonly success: true }
  | { readonly success: false; readonly reason: RevokeInvitationFailureReason };

// ── Use Case ─────────────────────────────────────────────────────────────────

export function revokeInvitation(cmd: RevokeInvitationCommand): RevokeInvitationResult {
  const { invitation } = cmd;

  if (!invitation) {
    return { success: false, reason: "NOT_FOUND" };
  }

  if (invitation.acceptedAt !== null) {
    return { success: false, reason: "ALREADY_ACCEPTED" };
  }

  if (invitation.revokedAt !== null) {
    return { success: false, reason: "ALREADY_REVOKED" };
  }

  return { success: true };
}
