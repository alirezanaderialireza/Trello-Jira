// packages/domain/src/checklists/errors.ts
//
// Domain errors are throw-able from the pure use cases. The router
// catches them at the boundary and translates into TRPCError with an
// English machine code (`code`) plus a Persian human message. Mirrors
// the labels-errors pattern from F1.2.1.

export class ChecklistTitleRequiredError extends Error {
  readonly code = "CHECKLIST_TITLE_REQUIRED" as const;
  constructor() {
    super("CHECKLIST_TITLE_REQUIRED");
    this.name = "ChecklistTitleRequiredError";
  }
}

export class ChecklistTitleTooLongError extends Error {
  readonly code = "CHECKLIST_TITLE_TOO_LONG" as const;
  constructor(public readonly maxLength: number) {
    super(`CHECKLIST_TITLE_TOO_LONG: max=${maxLength}`);
    this.name = "ChecklistTitleTooLongError";
  }
}

export class DuplicateChecklistTitleError extends Error {
  readonly code = "DUPLICATE_CHECKLIST_TITLE" as const;
  constructor(public readonly title: string) {
    super(`DUPLICATE_CHECKLIST_TITLE: ${title}`);
    this.name = "DuplicateChecklistTitleError";
  }
}

export class ChecklistItemTextRequiredError extends Error {
  readonly code = "CHECKLIST_ITEM_TEXT_REQUIRED" as const;
  constructor() {
    super("CHECKLIST_ITEM_TEXT_REQUIRED");
    this.name = "ChecklistItemTextRequiredError";
  }
}

export class ChecklistItemTextTooLongError extends Error {
  readonly code = "CHECKLIST_ITEM_TEXT_TOO_LONG" as const;
  constructor(public readonly maxLength: number) {
    super(`CHECKLIST_ITEM_TEXT_TOO_LONG: max=${maxLength}`);
    this.name = "ChecklistItemTextTooLongError";
  }
}

export class ChecklistNotFoundError extends Error {
  readonly code = "CHECKLIST_NOT_FOUND" as const;
  constructor() {
    super("CHECKLIST_NOT_FOUND");
    this.name = "ChecklistNotFoundError";
  }
}

export class ChecklistItemNotFoundError extends Error {
  readonly code = "CHECKLIST_ITEM_NOT_FOUND" as const;
  constructor() {
    super("CHECKLIST_ITEM_NOT_FOUND");
    this.name = "ChecklistItemNotFoundError";
  }
}

export class CardNotFoundError extends Error {
  readonly code = "CARD_NOT_FOUND" as const;
  constructor() {
    super("CARD_NOT_FOUND");
    this.name = "CardNotFoundError";
  }
}

export class ChecklistCardMismatchError extends Error {
  readonly code = "CHECKLIST_CARD_MISMATCH" as const;
  constructor() {
    super("CHECKLIST_CARD_MISMATCH");
    this.name = "ChecklistCardMismatchError";
  }
}

export type ChecklistDomainError =
  | ChecklistTitleRequiredError
  | ChecklistTitleTooLongError
  | DuplicateChecklistTitleError
  | ChecklistItemTextRequiredError
  | ChecklistItemTextTooLongError
  | ChecklistNotFoundError
  | ChecklistItemNotFoundError
  | CardNotFoundError
  | ChecklistCardMismatchError;
