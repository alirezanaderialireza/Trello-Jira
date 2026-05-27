// packages/api/src/middleware/invariants/errors.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// F2 invariant errors
//
// Most invariants reach for errors that already live in @repo/domain/workspaces.
// We re-export those verbatim so every invariant import comes from a single
// place — no caller has to remember which error lives where.
//
// Two errors are F2-specific (no domain analogue today, and adding them to
// the domain package would be a semantic stretch — they describe a *role
// transition*, not a workspace lifecycle violation):
//
//   AdminCannotRemoveOwnerError    — admin tried to remove/demote an OWNER
//   TransfereeMustBeMemberError    — transfer ownership target is not a member
//
// Each new error class carries a stable string `code` discriminator so
// router-side TRPCError mappers can switch on `code` instead of `instanceof`.
// ─────────────────────────────────────────────────────────────────────────────

export {
  InsufficientRoleError,
  LastOwnerCannotLeaveError,
  NotMemberError,
  PersonalWorkspaceCannotBeDeletedError,
} from "@repo/domain/workspaces";

export class AdminCannotRemoveOwnerError extends Error {
  readonly code = "ADMIN_CANNOT_REMOVE_OWNER" as const;
  constructor() {
    super("ADMIN_CANNOT_REMOVE_OWNER");
    this.name = "AdminCannotRemoveOwnerError";
  }
}

export class TransfereeMustBeMemberError extends Error {
  readonly code = "TRANSFEREE_MUST_BE_MEMBER" as const;
  constructor() {
    super("TRANSFEREE_MUST_BE_MEMBER");
    this.name = "TransfereeMustBeMemberError";
  }
}
