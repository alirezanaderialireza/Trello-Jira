// packages/domain/src/workspaces/use-cases/acceptInvitation.ts
//
// Pure domain use case: validate whether a workspace invitation can be
// accepted by the current user. No I/O — the router supplies the data,
// this function returns a Result discriminated union.
//
// Guards (in evaluation order):
//   1. Invitation must exist (NOT_FOUND).
//   2. Must not be revoked (REVOKED).
//   3. Must not be expired (EXPIRED).
//   4. If already accepted by the same user → idempotent success (ALREADY_ACCEPTED_BY_ME).
//   5. If already accepted by another user → reject (ALREADY_ACCEPTED_BY_OTHER).
//   6. Workspace must not be soft-deleted (WORKSPACE_DELETED).
//   7. Email of the accepting user must match invited_email (EMAIL_MISMATCH).

// ── Types ────────────────────────────────────────────────────────────────────

export interface AcceptInvitationCommand {
  /** The invitation row (or null if token lookup returned nothing). */
  readonly invitation: AcceptInvitationRow | null;
  /** The userId of the user attempting to accept. */
  readonly acceptingUserId: string;
  /** The normalized email of the accepting user (from users table). */
  readonly acceptingUserEmail: string;
  /** Whether the workspace is soft-deleted. */
  readonly workspaceDeleted: boolean;
  /** Current server time (UTC). */
  readonly now: Date;
}

export interface AcceptInvitationRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly invitedEmail: string; // normalized (lowercase)
  readonly role: string;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly acceptedByUserId: string | null;
  readonly revokedAt: Date | null;
}

// ── Result ───────────────────────────────────────────────────────────────────

export type AcceptInvitationFailureReason =
  | "NOT_FOUND"
  | "REVOKED"
  | "EXPIRED"
  | "ALREADY_ACCEPTED_BY_OTHER"
  | "WORKSPACE_DELETED"
  | "EMAIL_MISMATCH";

export type AcceptInvitationResult =
  | {
      readonly success: true;
      readonly alreadyAccepted: boolean;
      readonly workspaceId: string;
      readonly role: string;
    }
  | {
      readonly success: false;
      readonly reason: AcceptInvitationFailureReason;
    };

// ── Use Case ─────────────────────────────────────────────────────────────────

export function acceptInvitation(cmd: AcceptInvitationCommand): AcceptInvitationResult {
  const { invitation, acceptingUserId, acceptingUserEmail, workspaceDeleted, now } = cmd;

  // 1. Not found
  if (!invitation) {
    return { success: false, reason: "NOT_FOUND" };
  }

  // 2. Revoked
  if (invitation.revokedAt !== null) {
    return { success: false, reason: "REVOKED" };
  }

  // 3. Expired
  if (invitation.expiresAt < now) {
    return { success: false, reason: "EXPIRED" };
  }

  // 4 & 5. Already accepted
  if (invitation.acceptedAt !== null) {
    if (invitation.acceptedByUserId === acceptingUserId) {
      // Idempotent re-click — same user, success
      return {
        success: true,
        alreadyAccepted: true,
        workspaceId: invitation.workspaceId,
        role: invitation.role,
      };
    }
    // Accepted by someone else
    return { success: false, reason: "ALREADY_ACCEPTED_BY_OTHER" };
  }

  // 6. Workspace deleted
  if (workspaceDeleted) {
    return { success: false, reason: "WORKSPACE_DELETED" };
  }

  // 7. Email match (case-insensitive — both should be pre-normalized)
  if (acceptingUserEmail.toLowerCase() !== invitation.invitedEmail.toLowerCase()) {
    return { success: false, reason: "EMAIL_MISMATCH" };
  }

  // All guards passed
  return {
    success: true,
    alreadyAccepted: false,
    workspaceId: invitation.workspaceId,
    role: invitation.role,
  };
}
