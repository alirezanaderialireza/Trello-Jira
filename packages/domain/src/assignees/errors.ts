// packages/domain/src/assignees/errors.ts
//
// Phase 1.2 (F1.2.5) — Assignees domain errors.
// English code + Persian message (via toTRPCError in the router).

export class AssigneeNotBoardMemberError extends Error {
  readonly code = "ASSIGNEE_NOT_BOARD_MEMBER" as const;
  constructor() {
    super("ASSIGNEE_NOT_BOARD_MEMBER");
    this.name = "AssigneeNotBoardMemberError";
  }
}

export class AlreadyAssignedError extends Error {
  readonly code = "ALREADY_ASSIGNED" as const;
  constructor() {
    super("ALREADY_ASSIGNED");
    this.name = "AlreadyAssignedError";
  }
}

export class NotAssignedError extends Error {
  readonly code = "NOT_ASSIGNED" as const;
  constructor() {
    super("NOT_ASSIGNED");
    this.name = "NotAssignedError";
  }
}

export class MaxAssigneesError extends Error {
  readonly code = "MAX_ASSIGNEES" as const;
  constructor(public readonly max: number) {
    super(`MAX_ASSIGNEES: max=${max}`);
    this.name = "MaxAssigneesError";
  }
}

export class CardLockedAssigneeError extends Error {
  readonly code = "CARD_LOCKED_ASSIGNEE" as const;
  constructor() {
    super("CARD_LOCKED_ASSIGNEE");
    this.name = "CardLockedAssigneeError";
  }
}

export type AssigneeDomainError =
  | AssigneeNotBoardMemberError
  | AlreadyAssignedError
  | NotAssignedError
  | MaxAssigneesError
  | CardLockedAssigneeError;
