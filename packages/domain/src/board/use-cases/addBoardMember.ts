// packages/domain/src/board/use-cases/addBoardMember.ts
//
// Pure-domain use case: validate whether a user can be added as a board
// member.
//
// The router supplies pre-fetched lookup results; this function only
// applies the invariants and returns a Result. No I/O.
//
// Invariants (in evaluation order):
//   1. Caller cannot add themselves (use createBoard for the first OWNER).
//   2. Target must already be a member of the board's parent workspace.
//      Boards inherit security boundaries from workspaces — a stranger
//      cannot be invited into a board without first being a workspace
//      member. This mirrors the Trello model and prevents the "ghost
//      member" class of bugs where a user has board access but cannot
//      see anything in the workspace context.
//   3. Target cannot already hold an active membership row on this board.
//      The router uses this signal to decide between INSERT and
//      "reactivate previously-removed row" paths.

// ── Types ────────────────────────────────────────────────────────────────────

export interface AddBoardMemberCommand {
  /** UUID of the user issuing the add (must be a board ADMIN/OWNER). */
  readonly callerUserId: string;
  /** UUID of the user being added. */
  readonly targetUserId: string;
  /** True if the target has an active row in workspace_members. */
  readonly targetIsWorkspaceMember: boolean;
  /**
   * The current state of the (boardId, targetUserId) row in board_members,
   * or `null` if no row exists. The router passes this in so the use case
   * can stay pure.
   *
   * The router decides downstream what to do with `existingActive` —
   * typically idempotent success (no INSERT, no event).
   */
  readonly existingMembership:
    | { readonly id: string; readonly removedAt: Date | null }
    | null;
}

// ── Result ───────────────────────────────────────────────────────────────────

export type AddBoardMemberFailureReason =
  | "SELF_INVITE"
  | "TARGET_NOT_WORKSPACE_MEMBER";

export type AddBoardMemberAction =
  /** Caller already holds an active row — return idempotent success. */
  | "ALREADY_ACTIVE_MEMBER"
  /** Reactivate the previously-removed row (UPDATE removedAt = null). */
  | "REACTIVATE_REMOVED_ROW"
  /** Insert a fresh membership row. */
  | "INSERT_NEW_ROW";

export type AddBoardMemberResult =
  | {
      readonly success: true;
      readonly action: AddBoardMemberAction;
    }
  | {
      readonly success: false;
      readonly reason: AddBoardMemberFailureReason;
    };

// ── Use Case ─────────────────────────────────────────────────────────────────

export function addBoardMember(cmd: AddBoardMemberCommand): AddBoardMemberResult {
  // 1. Self-invite is rejected. The board's first OWNER is always set by
  //    createBoard inline; subsequent self-add is never valid.
  if (cmd.callerUserId === cmd.targetUserId) {
    return { success: false, reason: "SELF_INVITE" };
  }

  // 2. Target must be a workspace member first. This is the security
  //    invariant the F3b plan flagged.
  if (!cmd.targetIsWorkspaceMember) {
    return { success: false, reason: "TARGET_NOT_WORKSPACE_MEMBER" };
  }

  // 3. Membership state machine.
  if (cmd.existingMembership === null) {
    return { success: true, action: "INSERT_NEW_ROW" };
  }
  if (cmd.existingMembership.removedAt === null) {
    return { success: true, action: "ALREADY_ACTIVE_MEMBER" };
  }
  return { success: true, action: "REACTIVATE_REMOVED_ROW" };
}
