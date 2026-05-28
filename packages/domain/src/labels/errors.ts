// packages/domain/src/labels/errors.ts
//
// Domain errors are throw-able from the pure use cases. The router
// catches them at the boundary and translates into TRPCError with an
// English machine code (`code`) plus a Persian human message
// (`message`). Keeping the error class names predictable lets the
// router instanceof-match cleanly.

export class LabelNameRequiredError extends Error {
  readonly code = "LABEL_NAME_REQUIRED" as const;
  constructor() {
    super("LABEL_NAME_REQUIRED");
    this.name = "LabelNameRequiredError";
  }
}

export class LabelNameTooLongError extends Error {
  readonly code = "LABEL_NAME_TOO_LONG" as const;
  constructor(public readonly maxLength: number) {
    super(`LABEL_NAME_TOO_LONG: max=${maxLength}`);
    this.name = "LabelNameTooLongError";
  }
}

export class DuplicateLabelNameError extends Error {
  readonly code = "DUPLICATE_LABEL_NAME" as const;
  constructor(public readonly name: string) {
    super(`DUPLICATE_LABEL_NAME: ${name}`);
    this.name = "DuplicateLabelNameError";
  }
}

export class InvalidColorTokenError extends Error {
  readonly code = "INVALID_COLOR_TOKEN" as const;
  constructor(public readonly token: string) {
    super(`INVALID_COLOR_TOKEN: ${token}`);
    this.name = "InvalidColorTokenError";
  }
}

export class LabelNotFoundError extends Error {
  readonly code = "LABEL_NOT_FOUND" as const;
  constructor() {
    super("LABEL_NOT_FOUND");
    this.name = "LabelNotFoundError";
  }
}

export class CardNotFoundError extends Error {
  readonly code = "CARD_NOT_FOUND" as const;
  constructor() {
    super("CARD_NOT_FOUND");
    this.name = "CardNotFoundError";
  }
}

export class LabelBoardMismatchError extends Error {
  readonly code = "LABEL_BOARD_MISMATCH" as const;
  constructor() {
    super("LABEL_BOARD_MISMATCH");
    this.name = "LabelBoardMismatchError";
  }
}

/**
 * Discriminated union of every domain error this slice can produce.
 * Useful for exhaustive `instanceof` chains in the router.
 */
export type LabelDomainError =
  | LabelNameRequiredError
  | LabelNameTooLongError
  | DuplicateLabelNameError
  | InvalidColorTokenError
  | LabelNotFoundError
  | CardNotFoundError
  | LabelBoardMismatchError;
