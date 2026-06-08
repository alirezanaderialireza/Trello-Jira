// packages/domain/src/attachments/index.ts
//
// Public barrel for the attachments slice.
// `import { AttachmentId, addFileAttachment } from "@repo/domain"` is canonical.

export * from "./types";
export * from "./errors";
export * from "./use-cases/addFileAttachment";
export * from "./use-cases/addLinkAttachment";
export * from "./use-cases/removeAttachment";
