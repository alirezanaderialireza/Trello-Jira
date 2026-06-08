// packages/domain/src/attachments/errors.ts
//
// Phase 1.2 (F1.2.8) — Attachment domain errors.
// English code + Persian message in the router via toTRPCError().

export class AttachmentNotFoundError extends Error {
  readonly code = "ATTACHMENT_NOT_FOUND" as const;
  constructor() {
    super("ATTACHMENT_NOT_FOUND");
    this.name = "AttachmentNotFoundError";
  }
}

export class AttachmentCardMismatchError extends Error {
  readonly code = "ATTACHMENT_CARD_MISMATCH" as const;
  constructor() {
    super("ATTACHMENT_CARD_MISMATCH");
    this.name = "AttachmentCardMismatchError";
  }
}

export class AttachmentUploaderOnlyError extends Error {
  readonly code = "ATTACHMENT_UPLOADER_ONLY" as const;
  constructor() {
    super("ATTACHMENT_UPLOADER_ONLY");
    this.name = "AttachmentUploaderOnlyError";
  }
}

export class AttachmentLimitError extends Error {
  readonly code = "ATTACHMENT_LIMIT" as const;
  constructor(public readonly max: number) {
    super(`ATTACHMENT_LIMIT: max=${max}`);
    this.name = "AttachmentLimitError";
  }
}

export class AttachmentFileSizeError extends Error {
  readonly code = "ATTACHMENT_FILE_SIZE" as const;
  constructor(public readonly maxMb: number) {
    super(`ATTACHMENT_FILE_SIZE: max=${maxMb}MB`);
    this.name = "AttachmentFileSizeError";
  }
}

export type AttachmentDomainError =
  | AttachmentNotFoundError
  | AttachmentCardMismatchError
  | AttachmentUploaderOnlyError
  | AttachmentLimitError
  | AttachmentFileSizeError;
