// packages/domain/src/comments/errors.ts
//
// Phase 1.2 (F1.2.4.a) — domain errors for the comments slice.
// Mirrors the checklists-errors pattern from F1.2.3.a.
//
// Each error carries an English `code` (for client branching) and
// the router maps them to TRPCError with a Persian human message via
// `toTRPCError()`. Persian messages live in the router to keep the
// domain layer language-agnostic.

export class CommentBodyRequiredError extends Error {
  readonly code = "COMMENT_BODY_REQUIRED" as const;
  constructor() {
    super("COMMENT_BODY_REQUIRED");
    this.name = "CommentBodyRequiredError";
  }
}

export class CommentBodyTooLongError extends Error {
  readonly code = "COMMENT_BODY_TOO_LONG" as const;
  constructor(public readonly maxLength: number) {
    super(`COMMENT_BODY_TOO_LONG: max=${maxLength}`);
    this.name = "CommentBodyTooLongError";
  }
}

export class CommentNotFoundError extends Error {
  readonly code = "COMMENT_NOT_FOUND" as const;
  constructor() {
    super("COMMENT_NOT_FOUND");
    this.name = "CommentNotFoundError";
  }
}

export class CommentCardMismatchError extends Error {
  readonly code = "COMMENT_CARD_MISMATCH" as const;
  constructor() {
    super("COMMENT_CARD_MISMATCH");
    this.name = "CommentCardMismatchError";
  }
}

export class CommentAuthorOnlyError extends Error {
  readonly code = "COMMENT_AUTHOR_ONLY" as const;
  constructor() {
    super("COMMENT_AUTHOR_ONLY");
    this.name = "CommentAuthorOnlyError";
  }
}

export type CommentDomainError =
  | CommentBodyRequiredError
  | CommentBodyTooLongError
  | CommentNotFoundError
  | CommentCardMismatchError
  | CommentAuthorOnlyError;
