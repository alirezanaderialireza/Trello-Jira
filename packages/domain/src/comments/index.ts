// packages/domain/src/comments/index.ts
//
// Public barrel for the comments slice. Mirrors the checklists pattern.
// `import { CommentId, createComment } from "@repo/domain"` is the
// canonical import path for all consumers.

export * from "./types";
export * from "./errors";
export * from "./use-cases/createComment";
export * from "./use-cases/updateComment";
export * from "./use-cases/deleteComment";
